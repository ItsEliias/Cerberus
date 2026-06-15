// Cerberus OS — graph data store (tasks + change events)

const TASKS_KEY = 'cerberus_graph_tasks_v1';

let _tasks = [];

function _uid() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function emitGraphChanged() {
  window.dispatchEvent(new CustomEvent('cerberus-graph-changed'));
}

export function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    _tasks = raw ? JSON.parse(raw) : [];
  } catch (_) {
    _tasks = [];
  }
  return _tasks;
}

export function saveTasks() {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(_tasks));
  } catch (_) {}
  emitGraphChanged();
}

export function getTasks() {
  if (!_tasks.length) loadTasks();
  return _tasks;
}

export function addTask(task) {
  const t = {
    id: _uid(),
    title: task.title || 'New Task',
    projectId: task.projectId || '',
    officeId: task.officeId || '',
    departmentId: task.departmentId || '',
    agentId: task.agentId || '',
    subAgentId: task.subAgentId || '',
    status: task.status || 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  _tasks.push(t);
  saveTasks();
  return t;
}

export function updateTask(id, patch) {
  const t = _tasks.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  saveTasks();
  return t;
}

export function deleteTask(id) {
  _tasks = _tasks.filter((x) => x.id !== id);
  saveTasks();
}
