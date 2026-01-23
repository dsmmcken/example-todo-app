import { useState } from "react";
import Todo from "./Todo";
import NewTodoForm from "./NewTodoForm";
import { v4 as uuid } from "uuid";
import "./TodoList.css";

export interface TodoItem {
  id: string;
  task: string;
  completed: boolean;
}

function TodoList() {
  const [todos, setTodos] = useState<TodoItem[]>([
    { id: uuid(), task: "Learn React", completed: true },
    { id: uuid(), task: "Add new todo", completed: false },
    { id: uuid(), task: "Delete this todo", completed: false },
    { id: uuid(), task: "Allow marking items undone", completed: false },
    { id: uuid(), task: "Disallow blank todos", completed: false },
  ]);

  const create = (newTodo: TodoItem) => {
    setTodos((prevTodos) => [...prevTodos, newTodo]);
  };

  const remove = (id: string) => {
    setTodos((todos) => todos.filter((todo) => todo.id !== id));
  };

  const toggleComplete = (id: string) => {
    setTodos((todos) =>
      todos.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo,
      ),
    );
  };

  return (
    <div className="TodoList">
      <h1>
        Todo List <span>A simple React Todo List App</span>
      </h1>
      <ul>
        {todos.map((todo) => (
          <Todo
            key={todo.id}
            todo={todo}
            remove={remove}
            toggleComplete={toggleComplete}
          />
        ))}
      </ul>
      <NewTodoForm create={create} />{" "}
      <div className="logo-container">
        <svg
          viewBox="0 0 57 57"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="deephaven-logo"
        >
          <rect y="38.1" width="18.9" height="18.9" fill="#4DCCFA" />
          <rect x="18.9" width="18.9" height="18.9" fill="#4DCCFA" />
          <rect x="18.9" y="38.1" width="18.9" height="18.9" fill="#FDD041" />
          <rect x="37.8" y="19" width="18.9" height="18.9" fill="#F33666" />
          <rect y="0" width="18.9" height="38.1" fill="#3A57E1" />
        </svg>
      </div>{" "}
    </div>
  );
}

export default TodoList;
