import { useState } from "react";
import Todo from "./Todo";
import NewTodoForm from "./NewTodoForm";
import DeephavenLogo from "./DeephavenLogo";
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
    console.log(newTodo);
    todos.push(newTodo);
  };

  const remove = (id: string) => {
    setTodos((todos) => todos.filter((todo) => todo.id !== id));
  };

  const toggleComplete = (id: string) => {
    const updatedTodos = todos.map((todo) => {
      if (todo.id === id) {
        return { ...todo, completed: true };
      }
      return todo;
    });
    setTodos(updatedTodos);
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
        <DeephavenLogo />
      </div>{" "}
    </div>
  );
}

export default TodoList;
