package fm.curry.outliner

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Files for the editor. The page calls Android.call(id, method, argJson); the answer comes back through
 * window.__resolve(id, json). Two kinds of file, told apart by the path the editor holds:
 *   "gc:/home/adam/…/NA-1910.opml"  an outline on godcaster, through outliner-sync on the tailnet
 *   "content://…"                   a file on this phone, chosen in the Android file picker
 * Saving keeps the desktop's rules: refuse when the file changed since it was opened (unless forced),
 * keep a backup of the old version first.
 */
class Bridge(private val act: MainActivity) {
    private val io = Executors.newFixedThreadPool(3)
    private val prefs = act.getSharedPreferences("outliner", Context.MODE_PRIVATE)
    private var pending: Pair<String, String>? = null      // (callId, "choose"|"create") waiting on the picker
    private var pendingText: JSONObject? = null            // Save as Markdown: {name, mime, text} for the "save as" picker
    private val ua = "OPMLOutlinerAndroid/${BuildConfig.VERSION_NAME} (Adam Curry's OPML Outliner)"

    private val server get() = prefs.getString("server", DEFAULT_SERVER)!!.trimEnd('/')

    @JavascriptInterface
    fun call(id: String, method: String, arg: String) {
        if (method == "choose" || method == "create" || method == "cartUpload" || method == "pickPicture") { act.runOnUiThread { pick(id, method) }; return }
        // Save as Markdown (2026-11-18): the phone's "save as" picker, then write the text the page made
        if (method == "createText") { pendingText = runCatching { JSONObject(arg) }.getOrNull(); act.runOnUiThread { pick(id, method) }; return }
        io.execute {
            val out: Any? = try {
                val a = if (arg.isBlank()) JSONObject() else JSONObject(arg)
                when (method) {
                    "remoteRecent" -> JSONObject(http("GET", "/v1/recent", null))
                    "read" -> read(a.getString("abs"))
                    "save" -> save(a)
                    "localRecent" -> JSONObject().put("files", localRecent())
                    "forgetLocal" -> { forget(a.getString("abs")); JSONObject().put("ok", true) }
                    "getServer" -> JSONObject().put("server", server)
                    "setServer" -> { prefs.edit().putString("server", a.getString("server")).apply(); JSONObject().put("ok", true) }
                    "lastFile" -> JSONObject().put("abs", prefs.getString("last", null) ?: JSONObject.NULL)
                    "openUrl" -> { act.openUrl(a.getString("url")); JSONObject().put("ok", true) }
                    // publishing to adam.curry.com: cartpub on helix (tailnet; it checks the Tailscale login)
                    "cartGet" -> cart("GET", a.getString("path"), null, null)
                    "cartPost" -> cart("POST", a.getString("path"), a.getJSONObject("body").toString().toByteArray(), "application/json")
                    "fetchUrl" -> fetchUrl(a.getString("url"))
                    "pubRead" -> pubRead(a.getString("name"))
                    "pubWrite" -> { pubFile(a.getString("name")).also { backup(it) }.writeText(a.getString("xml")); JSONObject().put("ok", true) }
                    "prefGet" -> JSONObject().put("value", prefs.getString("p:" + a.getString("key"), null) ?: JSONObject.NULL)
                    "prefSet" -> { prefs.edit().putString("p:" + a.getString("key"), a.getString("value")).apply(); JSONObject().put("ok", true) }
                    "pubMark" -> { prefs.edit().putString("pubhash:" + a.getString("name"), a.getString("hash")).apply(); JSONObject().put("ok", true) }
                    else -> JSONObject().put("error", "unknown $method")
                }
            } catch (e: Exception) { JSONObject().put("error", e.message ?: e.toString()) }
            resolve(id, out)
        }
    }

    private fun resolve(id: String, v: Any?) =
        act.js("window.__resolve(${JSONObject.quote(id)}, ${JSONObject.quote(v?.toString() ?: "null")})")

    // ---------- godcaster (outliner-sync) ----------
    private fun http(method: String, path: String, body: JSONObject?): String {
        val c = URL(server + path).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 8000; c.readTimeout = 30000
        c.setRequestProperty("User-Agent", ua)
        if (body != null) {
            c.doOutput = true; c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        if (code >= 400) throw Exception(runCatching { JSONObject(text).optString("error") }.getOrNull()?.ifBlank { null } ?: "godcaster said HTTP $code")
        return text
    }

    private fun read(abs: String): JSONObject {
        if (abs.startsWith("pub:")) {
            val f = pubFile(abs.removePrefix("pub:"))
            prefs.edit().putString("last", abs).apply()
            return JSONObject().put("xml", f.readText()).put("mtimeMs", f.lastModified().toDouble()).put("path", abs)
        }
        if (abs.startsWith("gc:")) {
            val j = JSONObject(http("GET", "/v1/file?path=" + URLEncoder.encode(abs.removePrefix("gc:"), "UTF-8"), null))
            prefs.edit().putString("last", abs).apply()
            return j.put("path", abs)
        }
        val u = Uri.parse(abs)
        val xml = act.contentResolver.openInputStream(u)!!.use { it.readBytes().toString(Charsets.UTF_8) }
        remember(abs, nameOf(u))
        return JSONObject().put("xml", xml).put("mtimeMs", modified(u)).put("path", abs)
    }

    private fun save(a: JSONObject): JSONObject {
        val abs = a.getJSONObject("rel").getString("abs")
        val xml = a.getString("xml"); val force = a.optBoolean("force"); val opened = a.optDouble("mtimeMs", 0.0)
        if (abs.startsWith("gc:")) {
            return JSONObject(http("POST", "/v1/file", JSONObject().put("path", abs.removePrefix("gc:")).put("xml", xml)
                .put("mtimeMs", if (opened > 0) opened else JSONObject.NULL).put("force", force))).also {
                if (it.has("path")) it.put("path", abs)
            }
        }
        if (!xml.contains("<opml") || !xml.trimEnd().endsWith("</opml>")) return JSONObject().put("error", "refusing to save: that is not a whole OPML document")
        if (abs.startsWith("pub:")) {
            val f = pubFile(abs.removePrefix("pub:"))
            if (!force && opened > 0 && f.exists() && Math.abs(f.lastModified() - opened) > 1) return JSONObject().put("conflict", true)
            backup(f)
            val tmp = File(f.parentFile, f.name + ".tmp"); tmp.writeText(xml); tmp.renameTo(f)
            return JSONObject().put("ok", true).put("mtimeMs", f.lastModified().toDouble()).put("path", abs)
        }
        val u = Uri.parse(abs)
        val disk = modified(u)
        if (!force && opened > 0 && disk > 0 && Math.abs(disk - opened) > 1) return JSONObject().put("conflict", true).put("diskMtimeMs", disk)
        // backup of the version on the phone, newest 30 per name
        runCatching {
            val dir = File(act.filesDir, "backups").apply { mkdirs() }
            val base = nameOf(u).removeSuffix(".opml")
            act.contentResolver.openInputStream(u)?.use { inp ->
                File(dir, "$base--${SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss-SSS", Locale.US).format(Date())}.opml").outputStream().use { inp.copyTo(it) }
            }
            dir.listFiles { f -> f.name.startsWith("$base--") }?.sortedBy { it.name }?.dropLast(30)?.forEach { it.delete() }
        }
        act.contentResolver.openOutputStream(u, "wt")!!.use { it.write(xml.toByteArray()) }
        return JSONObject().put("ok", true).put("mtimeMs", modified(u).takeIf { it > 0 } ?: System.currentTimeMillis().toDouble()).put("path", abs)
    }

    // ---------- this phone's files (Storage Access Framework) ----------
    private fun pick(id: String, what: String) {
        pending = id to what
        val i = if (what == "choose" || what == "cartUpload") Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
        } else if (what == "pickPicture") Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "image/*"
        } else if (what == "createText") Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = pendingText?.optString("mime", "text/markdown") ?: "text/markdown"
            putExtra(Intent.EXTRA_TITLE, pendingText?.optString("name", "outline.md") ?: "outline.md")
        } else Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "text/x-opml+xml"; putExtra(Intent.EXTRA_TITLE, "New outline.opml")
        }
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        @Suppress("DEPRECATION") act.startActivityForResult(i, when (what) { "choose" -> 41; "create" -> 42; "createText" -> 44; "pickPicture" -> 45; else -> 43 })
    }

    fun onActivityResult(req: Int, res: Int, data: Intent?) {
        val (id, what) = pending ?: return
        pending = null
        val u = data?.data
        if (res != Activity.RESULT_OK || u == null) { resolve(id, null); return }
        if (what == "pickPicture") {    // Picture: made web-sized on the phone, then sent to cartpub → noagendaassets.com/enc
            io.execute {
                val out = try {
                    val (bytes, name, wh) = webPicture(u)
                    cart("POST", "/api/upload?name=" + URLEncoder.encode(name, "UTF-8"), bytes, "application/octet-stream")
                        .apply { if (has("url")) put("width", wh.first).put("height", wh.second) }
                } catch (e: Exception) { JSONObject().put("error", e.message ?: e.toString()) }
                resolve(id, out)
            }
            return
        }
        if (what == "createText") {
            val text = pendingText?.optString("text") ?: ""; pendingText = null
            io.execute {
                val out = try {
                    act.contentResolver.openOutputStream(u, "wt")!!.use { it.write(text.toByteArray()) }
                    JSONObject().put("ok", true).put("name", nameOf(u))
                } catch (e: Exception) { JSONObject().put("error", e.message ?: e.toString()) }
                resolve(id, out)
            }
            return
        }
        if (what == "cartUpload") {     // Attach: send the chosen file to cartpub → noagendaassets.com/enc
            io.execute {
                val out = try {
                    val bytes = act.contentResolver.openInputStream(u)!!.use { it.readBytes() }
                    cart("POST", "/api/upload?name=" + URLEncoder.encode(nameOf(u), "UTF-8"), bytes, "application/octet-stream")
                } catch (e: Exception) { JSONObject().put("error", e.message ?: e.toString()) }
                resolve(id, out)
            }
            return
        }
        io.execute {
            val out = try {
                runCatching { act.contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
                val name = nameOf(u)
                if (what == "create") {
                    val t = name.removeSuffix(".opml").replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;")
                    act.contentResolver.openOutputStream(u, "wt")!!.use {
                        it.write(("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n  <head>\n    <title>$t</title>\n  </head>\n" +
                                  "  <body>\n    <outline text=\"$t\"/>\n  </body>\n</opml>\n").toByteArray())
                    }
                }
                remember(u.toString(), name)
                JSONObject().put("abs", u.toString()).put("name", name)
            } catch (e: Exception) { JSONObject().put("error", e.message) }
            resolve(id, out)
        }
    }

    /** A phone photo made right for a web page: upright (camera orientation applied), at most 1600 px on its longest
     *  side, JPEG 85. A small JPEG/PNG that is already upright and small enough, and every GIF (it may move), go as they are.
     *  Returns (bytes, file name, width to height). */
    private fun webPicture(u: Uri): Triple<ByteArray, String, Pair<Int, Int>> {
        val raw = act.contentResolver.openInputStream(u)!!.use { it.readBytes() }
        val name = nameOf(u).ifBlank { "picture.jpg" }
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, o)
        val w = o.outWidth; val h = o.outHeight
        if (w <= 0 || h <= 0) throw Exception("that file is not a picture this phone can read")
        val orient = runCatching { ExifInterface(ByteArrayInputStream(raw)).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) }.getOrDefault(1)
        val max = 1600
        val keep = o.outMimeType == "image/gif" ||
            (maxOf(w, h) <= max && orient == 1 && raw.size < 1_500_000 && (o.outMimeType == "image/jpeg" || o.outMimeType == "image/png"))
        if (keep) {
            val ext = when (o.outMimeType) { "image/gif" -> ".gif"; "image/png" -> ".png"; else -> ".jpg" }
            return Triple(raw, name.substringBeforeLast('.') + ext, w to h)
        }
        var sample = 1
        while (maxOf(w, h) / (sample * 2) >= max) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(raw, 0, raw.size, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw Exception("this phone could not open that picture")
        val scale = minOf(1f, max.toFloat() / maxOf(bmp.width, bmp.height))
        val m = Matrix().apply {
            postScale(scale, scale)
            when (orient) {
                ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(270f)
            }
        }
        val pic = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        val buf = ByteArrayOutputStream()
        pic.compress(Bitmap.CompressFormat.JPEG, 85, buf)
        return Triple(buf.toByteArray(), name.substringBeforeLast('.') + ".jpg", pic.width to pic.height)
    }

    /** A file opened from a file manager ("Open with OPML Outliner"). */
    fun openFromIntent(u: Uri) {
        io.execute {
            runCatching { act.contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
            val name = runCatching { nameOf(u) }.getOrDefault("outline.opml")
            remember(u.toString(), name)
            act.js("window.__openPath && window.__openPath(${JSONObject.quote(u.toString())}, ${JSONObject.quote(name)})")
        }
    }

    private fun nameOf(u: Uri): String = act.contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null } ?: (u.lastPathSegment ?: "outline.opml")

    private fun modified(u: Uri): Double = runCatching {
        act.contentResolver.query(u, arrayOf(DocumentsContract.Document.COLUMN_LAST_MODIFIED), null, null, null)?.use {
            if (it.moveToFirst() && !it.isNull(0)) it.getLong(0).toDouble() else 0.0 }
    }.getOrNull() ?: 0.0

    private fun localRecent(): JSONArray = runCatching { JSONArray(prefs.getString("recent", "[]")) }.getOrDefault(JSONArray())

    private fun remember(abs: String, name: String) {
        val old = localRecent(); val out = JSONArray().put(JSONObject().put("abs", abs).put("name", name).put("t", System.currentTimeMillis()))
        for (i in 0 until old.length()) { val o = old.optJSONObject(i) ?: continue; if (o.optString("abs") != abs && out.length() < 15) out.put(o) }
        prefs.edit().putString("recent", out.toString()).putString("last", abs).apply()
    }

    private fun forget(abs: String) {
        val old = localRecent(); val out = JSONArray()
        for (i in 0 until old.length()) { val o = old.optJSONObject(i) ?: continue; if (o.optString("abs") != abs) out.put(o) }
        prefs.edit().putString("recent", out.toString()).apply()
        runCatching { act.contentResolver.releasePersistableUriPermission(Uri.parse(abs), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
    }

    // ---------- adam.curry.com (cartpub on helix) ----------
    private fun cart(method: String, path: String, body: ByteArray?, type: String?): JSONObject {
        val c = URL(CARTPUB + path).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 10000; c.readTimeout = 300000
        c.setRequestProperty("User-Agent", ua)
        if (body != null) {
            c.doOutput = true; c.setRequestProperty("Content-Type", type); c.setFixedLengthStreamingMode(body.size)
            c.outputStream.use { it.write(body) }
        }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
        return runCatching { JSONObject(text) }.getOrElse { JSONObject().put("error", "the publishing service said HTTP $code") }
    }

    private fun fetchUrl(url: String): JSONObject {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return JSONObject().put("error", "the address must start with http:// or https://")
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000; c.readTimeout = 30000; c.setRequestProperty("User-Agent", ua)
        if (c.responseCode >= 400) return JSONObject().put("error", "HTTP ${c.responseCode}")
        val raw = c.inputStream.use { it.readBytes() }
        val bytes = if (raw.size > 2 && raw[0] == 0x1f.toByte() && raw[1] == 0x8b.toByte()) java.util.zip.GZIPInputStream(raw.inputStream()).readBytes() else raw
        return JSONObject().put("xml", bytes.toString(Charsets.UTF_8))
    }

    /** A published page opened on the phone lives in the app's own folder under its cart filename ("pub:<file>"). */
    private fun pubFile(name: String): File {
        val n = File(name).name
        require(Regex("[A-Za-z0-9._-]+\\.opml").matches(n)) { "bad page name" }
        return File(File(act.filesDir, "published").apply { mkdirs() }, n)
    }
    private fun pubRead(name: String): JSONObject {
        val f = pubFile(name)
        return JSONObject().put("xml", if (f.exists()) f.readText() else JSONObject.NULL)
            .put("hash", prefs.getString("pubhash:" + f.name, null) ?: JSONObject.NULL)
    }
    private fun backup(f: File) {
        if (!f.exists()) return
        runCatching {
            val dir = File(act.filesDir, "backups").apply { mkdirs() }
            val base = f.name.removeSuffix(".opml")
            f.copyTo(File(dir, "$base--${SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss-SSS", Locale.US).format(Date())}.opml"))
            dir.listFiles { x -> x.name.startsWith("$base--") }?.sortedBy { it.name }?.dropLast(30)?.forEach { it.delete() }
        }
    }

    companion object {
        const val DEFAULT_SERVER = "http://100.122.226.90:8792"
        const val CARTPUB = "http://100.76.9.38:8793"      // helix
    }
}
