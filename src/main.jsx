import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./error-boundary.jsx";
import "./styles.css";
import { registerPwa } from "./pwa.js";
import { LOCALE } from "./locale.js";
import { initAnalytics } from "./analytics.js";

registerPwa();
void initAnalytics();
document.documentElement.lang = LOCALE;

createRoot(document.getElementById("root")).render(
	<StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</StrictMode>,
);
