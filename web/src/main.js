import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const target = document.getElementById("app");
target.replaceChildren(); // Hinweis aus index.html für den Fall, dass dieses Skript gar nicht lädt.
mount(App, { target });
