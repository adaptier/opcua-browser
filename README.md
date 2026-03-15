# OPC-UA Browser

A CLI-based OPC-UA browser with an optional interactive TUI, built with Node.js and TypeScript.

## Features

- **CLI Mode**: Displays detailed information about nodes including Node ID, Browse Name, Display Name, Node Class, and for Variables: Data Type, Current Value, and Access Level
- **TUI Mode**: Interactive terminal interface with a list view and detailed information panel showing comprehensive node information

## Installation

```bash
npm install -g .
```

Or run locally:

```bash
npm install
npm run build
```

## Usage

### CLI Mode

Browse the OPC-UA server and display detailed root folder contents:

```bash
opcua-browser opc.tcp://localhost:54840
```

Output includes:
- Node ID
- Browse Name
- Display Name
- Node Class
- For Variables: Data Type, Current Value, Access Level

### TUI Mode

Start the interactive TUI for browsing:

```bash
opcua-browser opc.tcp://localhost:54840 --tui
```

In TUI mode:

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate node list |
| `Enter` | Browse into selected node |
| `←` / `Backspace` | Go back to parent node |
| `e` | Open write dialog for writable variables |
| `q` / `Ctrl+C` | Quit |

**Write dialog** (`e`):

| Key | Action |
|-----|--------|
| `Enter` | Submit new value |
| `Esc` | Cancel |

Values are entered as JSON (e.g. `25.5`, `true`, `"hello"`).

## Dependencies

- node-opcua: For OPC-UA client functionality
- commander: For CLI argument parsing
- blessed: For terminal UI

## Development

```bash
npm run dev  # Run with ts-node
npm run build  # Build to dist/
npm start  # Run built version
```