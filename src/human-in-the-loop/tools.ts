import type { ToolDefinition } from "../shared/types.js";

// ─── Tool Definitions (sent to the model) ────────────────────────────────────
//
// 7 tools spanning the full risk spectrum:
//   read-only : list_tasks, get_task_detail
//   low       : create_task
//   medium    : update_task_status, reassign_task
//   high      : delete_task
//   critical  : bulk_delete_tasks

export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "List all tasks on the sprint board. Optionally filter by status (open, in-progress, done).",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Filter by task status",
            enum: ["open", "in-progress", "done"],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_task_detail",
      description: "Get full details of a specific task by its ID (e.g. TASK-1).",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The task ID, e.g. TASK-1",
          },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a new task on the sprint board.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short title for the task",
          },
          assignee: {
            type: "string",
            description: "Person to assign the task to (Alice, Bob, or Charlie)",
          },
          priority: {
            type: "string",
            description: "Task priority",
            enum: ["low", "medium", "high"],
          },
        },
        required: ["title", "assignee"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task_status",
      description:
        "Change the status of an existing task. Use this to move tasks between open, in-progress, and done.",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The task ID to update",
          },
          new_status: {
            type: "string",
            description: "The new status",
            enum: ["open", "in-progress", "done"],
          },
        },
        required: ["task_id", "new_status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reassign_task",
      description: "Change who a task is assigned to.",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The task ID to reassign",
          },
          new_assignee: {
            type: "string",
            description: "The new assignee (Alice, Bob, or Charlie)",
          },
        },
        required: ["task_id", "new_assignee"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Permanently delete a task from the sprint board. This action cannot be undone.",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The task ID to delete",
          },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bulk_delete_tasks",
      description:
        "Delete ALL tasks matching a given status. This is a destructive batch operation that cannot be undone.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Delete all tasks with this status",
            enum: ["open", "in-progress", "done"],
          },
        },
        required: ["status"],
      },
    },
  },
];

// ─── Mock Task Board ─────────────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  status: "open" | "in-progress" | "done";
  assignee: string;
  priority: "low" | "medium" | "high";
  createdAt: string;
}

let nextId = 9;

function initialTasks(): Task[] {
  return [
    {
      id: "TASK-1",
      title: "Set up CI pipeline",
      status: "done",
      assignee: "Alice",
      priority: "high",
      createdAt: "2026-02-20",
    },
    {
      id: "TASK-2",
      title: "Design login page mockup",
      status: "done",
      assignee: "Bob",
      priority: "medium",
      createdAt: "2026-02-21",
    },
    {
      id: "TASK-3",
      title: "Implement auth API",
      status: "in-progress",
      assignee: "Alice",
      priority: "high",
      createdAt: "2026-02-22",
    },
    {
      id: "TASK-4",
      title: "Write unit tests for auth",
      status: "open",
      assignee: "Charlie",
      priority: "medium",
      createdAt: "2026-02-23",
    },
    {
      id: "TASK-5",
      title: "Set up staging environment",
      status: "in-progress",
      assignee: "Bob",
      priority: "high",
      createdAt: "2026-02-24",
    },
    {
      id: "TASK-6",
      title: "Create user profile page",
      status: "open",
      assignee: "Alice",
      priority: "low",
      createdAt: "2026-02-25",
    },
    {
      id: "TASK-7",
      title: "Database migration script",
      status: "open",
      assignee: "Charlie",
      priority: "high",
      createdAt: "2026-02-26",
    },
    {
      id: "TASK-8",
      title: "API rate limiting",
      status: "open",
      assignee: "Bob",
      priority: "medium",
      createdAt: "2026-02-27",
    },
  ];
}

let MOCK_TASKS: Task[] = initialTasks();

export function resetTaskBoard() {
  MOCK_TASKS = initialTasks();
  nextId = 9;
}

// ─── Tool Implementations ────────────────────────────────────────────────────

function listTasks(args: { status?: string }): string {
  let tasks = MOCK_TASKS;
  if (args.status) {
    tasks = tasks.filter((t) => t.status === args.status);
  }

  if (tasks.length === 0) {
    return JSON.stringify({ tasks: [], message: "No tasks found" });
  }

  return JSON.stringify({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assignee,
      priority: t.priority,
    })),
    total: tasks.length,
  });
}

function getTaskDetail(args: { task_id: string }): string {
  const task = MOCK_TASKS.find((t) => t.id === args.task_id);
  if (!task) {
    return JSON.stringify({ error: `Task ${args.task_id} not found` });
  }
  return JSON.stringify(task);
}

function createTask(args: { title: string; assignee: string; priority?: string }): string {
  const id = `TASK-${nextId++}`;
  const task: Task = {
    id,
    title: args.title,
    status: "open",
    assignee: args.assignee,
    priority: (args.priority as Task["priority"]) ?? "medium",
    createdAt: new Date().toISOString().split("T")[0],
  };
  MOCK_TASKS.push(task);
  return JSON.stringify({ success: true, task });
}

function updateTaskStatus(args: { task_id: string; new_status: string }): string {
  const task = MOCK_TASKS.find((t) => t.id === args.task_id);
  if (!task) {
    return JSON.stringify({ error: `Task ${args.task_id} not found` });
  }
  const oldStatus = task.status;
  task.status = args.new_status as Task["status"];
  return JSON.stringify({ success: true, taskId: task.id, oldStatus, newStatus: task.status });
}

function reassignTask(args: { task_id: string; new_assignee: string }): string {
  const task = MOCK_TASKS.find((t) => t.id === args.task_id);
  if (!task) {
    return JSON.stringify({ error: `Task ${args.task_id} not found` });
  }
  const oldAssignee = task.assignee;
  task.assignee = args.new_assignee;
  return JSON.stringify({
    success: true,
    taskId: task.id,
    oldAssignee,
    newAssignee: task.assignee,
  });
}

function deleteTask(args: { task_id: string }): string {
  const index = MOCK_TASKS.findIndex((t) => t.id === args.task_id);
  if (index === -1) {
    return JSON.stringify({ error: `Task ${args.task_id} not found` });
  }
  const deleted = MOCK_TASKS.splice(index, 1)[0];
  return JSON.stringify({ success: true, deleted: { id: deleted.id, title: deleted.title } });
}

function bulkDeleteTasks(args: { status: string }): string {
  const matching = MOCK_TASKS.filter((t) => t.status === args.status);
  if (matching.length === 0) {
    return JSON.stringify({ error: `No tasks with status "${args.status}" found` });
  }
  const deletedIds = matching.map((t) => t.id);
  MOCK_TASKS = MOCK_TASKS.filter((t) => t.status !== args.status);
  return JSON.stringify({ success: true, deletedCount: deletedIds.length, deletedIds });
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

export function executeTool(name: string, args: Record<string, string>): string {
  switch (name) {
    case "list_tasks":
      return listTasks(args as Parameters<typeof listTasks>[0]);
    case "get_task_detail":
      return getTaskDetail(args as Parameters<typeof getTaskDetail>[0]);
    case "create_task":
      return createTask(args as Parameters<typeof createTask>[0]);
    case "update_task_status":
      return updateTaskStatus(args as Parameters<typeof updateTaskStatus>[0]);
    case "reassign_task":
      return reassignTask(args as Parameters<typeof reassignTask>[0]);
    case "delete_task":
      return deleteTask(args as Parameters<typeof deleteTask>[0]);
    case "bulk_delete_tasks":
      return bulkDeleteTasks(args as Parameters<typeof bulkDeleteTasks>[0]);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
