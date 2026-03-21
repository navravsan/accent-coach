const domain =
  process.env.EXPO_PUBLIC_DOMAIN ||
  process.env.RAILWAY_PUBLIC_DOMAIN ||
  process.env.REPLIT_INTERNAL_APP_DOMAIN ||
  process.env.REPLIT_DEV_DOMAIN;

const origin = domain ? `https://${domain}/` : "https://localhost:8081/";

module.exports = {
  expo: {
    name: "Accent Pro",
    slug: "accent-pro",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "accentpro",
    userInterfaceStyle: "dark",
    newArchEnabled: true,
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0A0E17",
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: "com.myapp",
    },
    android: {
      package: "com.myapp",
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
    },
    web: {
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      ["expo-router", { origin }],
      "expo-font",
      "expo-web-browser",
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
