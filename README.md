# OPML Outliner for Android

An outline editor for Android phones, by Adam Curry. It edits OPML files (the outline format used by podcast show notes, blogrolls and outliners like Drummer) and publishes them to the web, as HTML pages or as Markdown pages for the Markdown web.

**[Download the APK](https://github.com/adamc199/opml-outliner-android/releases/latest)** (Android 10 or newer). Open the downloaded file on your phone to install it; Android asks once to allow installs from your browser or file app.

## What it does

- **Edit outlines:** tap to select, double-tap to open or close a line, long-press to edit. The toolbar has the keys a phone lacks: new line, indent, outdent, move up and down, undo, redo, delete. Bold, italics and links on selected words.
- **Your files:** open and save `.opml` files anywhere on the phone (Android's file picker). Every save keeps a backup.
- **Pictures:** pick a photo from the phone; it is made web-sized on the phone (upright, at most 1600 px), uploaded, and shown in the outline as the picture.
- **Markdown:** save an outline as a `.md` file, or publish it as Markdown. An outline becomes plain Markdown: a top line with nothing under it is a paragraph, a top line with lines under it is a heading with its lines as a list, and links, pictures, bold and italics carry over.
- **The Markdown web:** published Markdown uses the layout of the Markdown-web sites [BonBon](https://github.com/scripting/bonBon) reads: a page per day, each post in its day's folder, month and year pages, a `.well-known/toc.opml` calendar, previous/next/parent links in every page's front matter, and an RSS 2.0 feed.

## Publishing needs a server

Publishing (HTML pages, Markdown, picture uploads) goes to the author's own publishing service over a private network ([Tailscale](https://tailscale.com)). Set your own addresses in `Bridge.kt` (`CARTPUB`, `DEFAULT_SERVER`, placeholders here) and in `res/xml/network_security_config.xml`; the outliner-sync address can also be changed in the app (Files, "Godcaster address…"). Editing and saving files on the phone works without any server.

## Building

- JDK 21, Android SDK (platform 35, build-tools 35), Gradle 8.14.
- `app/src/main/assets/outliner.js` is the outline editor (shared with Adam's desktop outliner and CurryCaster II).
- Signing: set `OUTLINER_KEYSTORE` (path to your keystore) and `OUTLINER_KEYPASS` (its password) in the environment, then `gradle assembleRelease`. No keys or passwords are in this repository.
- `test/run.sh` is a web-layer test (phone-size headless Electron with a stand-in for the Android side); it expects the author's machines, so read it as an example.

## Files

- `app/src/main/assets/` — the app's screens: `index.html`, `app.js`, the editor `outliner.js`, publishing screens `outliner-publish.js`, the Markdown converter `outliner-markdown.js`.
- `app/src/main/java/fm/curry/outliner/` — the Android side: `MainActivity.kt` (the WebView) and `Bridge.kt` (files, pictures, the publishing service).
