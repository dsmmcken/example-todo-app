import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TodoList from "./TodoList";
import "./styles.css";

function App() {
  return (
    <div className="App">
      <TodoList />
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Failed to find the root element");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
