# Todo List App - Interview Exercise

A modern React TypeScript todo list application with intentional bugs for debugging practice.

## Overview

This is a simple todo list application built with:
- **React 18.3** - Modern React with hooks
- **TypeScript 5.7** - Strict type checking
- **Vite 6.0** - Fast build tooling and HMR
- **Vitest** - Unit testing framework

The app features a dark Monokai-inspired theme with Deephaven brand colors and monospace coding fonts.

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

## Your Task: Fix the Bugs! 🐛

This application contains **four intentional bugs** for you to find and fix. Work through them in order:

### 1. New Todo Bug
**Issue:** When you add a new todo item, it doesn't appear in the list.

**What to look for:** Check how new todos are being added to the state. Is the state being updated correctly?

### 2. Delete Button Bug
**Issue:** Clicking the delete (trash) button on a todo item doesn't remove it from the list.

**What to look for:** The button click is being handled, but is the remove function actually being called?

### 3. Toggle Completed Bug
**Issue:** Clicking on a todo item marks it as complete, but clicking it again doesn't mark it as incomplete.

**What to look for:** The toggle function exists, but is it properly toggling the completed state?

### 4. Blank Todos Bug
**Issue:** You can add empty/blank todo items to the list.

**What to look for:** There's no validation preventing blank todos from being added. Where should this validation be added?

## Tips

- Open the browser console to check for any warnings or errors
- Use React DevTools to inspect component state
- Test each fix thoroughly before moving to the next bug
- The bugs are intentional and representative of common React mistakes!

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
