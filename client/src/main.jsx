import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dropzone/styles.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import App from "./App.jsx";
import "./index.css";

const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "sm",
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
  fontFamilyMonospace: "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
  colors: {
    dark: [
      "#c1c2c5",
      "#a6a7ab",
      "#909296",
      "#5c5f66",
      "#373a40",
      "#2c2e33",
      "#212429",
      "#16181d",
      "#101216",
      "#0a0c0e",
    ],
  },
  components: {
    Button: {
      defaultProps: {
        size: "sm",
      },
    },
    Badge: {
      defaultProps: {
        radius: "sm",
      },
    },
    Modal: {
      defaultProps: {
        centered: true,
        overlayProps: {
          backgroundOpacity: 0.65,
          blur: 6,
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" zIndex={2000} autoClose={4000} />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
