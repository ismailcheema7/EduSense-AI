import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { Toaster } from "./ui";


createRoot(document.getElementById("root")!).render(
<React.StrictMode>
<BrowserRouter>
<Toaster>
<App />
</Toaster>
</BrowserRouter>
</React.StrictMode>
);