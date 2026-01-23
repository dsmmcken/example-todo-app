# Todo List App - Interview Exercise

A modern React TypeScript todo list application with intentional bugs for debugging practice.

## Overview

This is a simple todo list application built with:

- **React 18.3** - Modern React with hooks
- **TypeScript 5.7** - Strict type checking
- **Vite 6.0** - Fast build tooling and HMR
- **Vitest** - Unit testing framework

## Your Task: Fix the Bugs! 🐛

This application contains **four intentional bugs** for you to find and fix. Work through them in order:

### 1. New Todo Bug

**Issue:** When you add a new todo item, it doesn't appear in the list.

### 2. Delete Button Bug

**Issue:** Clicking the delete (trash) button on a todo item doesn't remove it from the list.

### 3. Toggle Completed Bug

**Issue:** Clicking on a todo item marks it as complete, but clicking it again doesn't mark it as incomplete.

### 4. Blank Todos Bug

**Issue:** You can add empty/blank todo items to the list.

## Tips

- Open the browser console to check for any warnings or errors
- Test each fix thoroughly before moving to the next bug
- The bugs are intentional and representative of common React mistakes!

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173` (or the next available port).

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

## Project Structure

```
src/
├── index.tsx           # App entry point
├── TodoList.tsx        # Main todo list component
├── Todo.tsx            # Individual todo item component
├── NewTodoForm.tsx     # Form for adding new todos
├── DeephavenLogo.tsx   # Deephaven logo component
└── *.css               # Component styles
```

## Technologies Used

- React 18.3 with TypeScript
- Vite 6.0 for fast development
- UUID for generating unique IDs
- CSS with custom Monokai-inspired theme

---

Good luck debugging! 🚀
