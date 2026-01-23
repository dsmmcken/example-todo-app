import { MouseEvent } from "react";
import { TodoItem } from "./TodoList";
import "./Todo.css";

interface TodoProps {
  todo: TodoItem;
  remove: (id: string) => void;
  toggleComplete: (id: string) => void;
}

function Todo({ todo, remove, toggleComplete }: TodoProps) {
  const handleDelete = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="Todo" onClick={() => toggleComplete(todo.id)}>
      <li className={todo.completed ? "Todo-task completed" : "Todo-task"}>
        {todo.task}
      </li>
      <div className="Todo-buttons">
        <button title="Delete" onClick={handleDelete}>
          <i className="fas fa-trash" />
        </button>
      </div>
    </div>
  );
}

export default Todo;
