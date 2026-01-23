import { useState, FormEvent, ChangeEvent } from "react";
import { v4 as uuid } from "uuid";
import { TodoItem } from "./TodoList";
import "./NewTodoForm.css";

interface NewTodoFormProps {
  create: (todo: TodoItem) => void;
}

function NewTodoForm({ create }: NewTodoFormProps) {
  const [task, setTask] = useState("");

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTask(event.target.value);
  };

  const handleSubmit = (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();

    const newTodo: TodoItem = {
      id: uuid(),
      task: task,
      completed: false,
    };
    create(newTodo);
    setTask("");
  };

  return (
    <form className="NewTodoForm" onSubmit={handleSubmit}>
      <label htmlFor="task">New Todo</label>
      <input
        value={task}
        onChange={handleChange}
        id="task"
        type="text"
        name="task"
        placeholder="New Todo"
      />
      <button type="submit">Add Todo</button>
    </form>
  );
}

export default NewTodoForm;
