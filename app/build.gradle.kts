plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "fm.curry.outliner"
    compileSdk = 35
    defaultConfig {
        applicationId = "fm.curry.outliner"
        minSdk = 29
        targetSdk = 35
        versionCode = 5
        versionName = "1.3.0"
    }
    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("OUTLINER_KEYSTORE") ?: "/home/adam/.android-keys/outliner.jks")
            storePassword = System.getenv("OUTLINER_KEYPASS") ?: ""
            keyAlias = "outliner"
            keyPassword = System.getenv("OUTLINER_KEYPASS") ?: ""
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}
dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
}
