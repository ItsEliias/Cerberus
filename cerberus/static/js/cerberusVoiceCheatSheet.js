// Cerberus OS — Voice Command Cheat Sheet (grouped reference, rendered on demand)

const COMMAND_GROUPS = [
  {
    id: 'navigation',
    label: 'Navigation',
    hint: 'Move around Cerberus without leaving the home screen.',
    commands: [
      { say: '“Open assistant”', does: 'Opens the Assistant modal' },
      { say: '“Open offices”', does: 'Opens the Offices modal' },
      { say: '“Open projects”', does: 'Opens the Projects modal' },
      { say: '“Open finance”', does: 'Opens the Finance modal' },
      { say: '“Open tasks”', does: 'Opens the Tasks modal' },
      { say: '“Open tools”', does: 'Opens the Tools modal' },
      { say: '“Open calendar” / “Open notes” / “Open library” / “Open cookbook”', does: 'Opens that tool' },
      { say: '“Open settings”', does: 'Opens Settings' },
      { say: '“Open voice commands”', does: 'Opens this cheat sheet' },
      { say: '“Open system monitor”', does: 'Opens the System Monitor' },
      { say: '”Go to home” / “Go to Nexus”', does: 'Returns to the Cerberus home view' },
      { say: '”Go to dashboard” / “Open dashboard”', does: 'Opens the Dashboard' },
    ],
  },
  {
    id: 'projects',
    label: 'Project commands',
    hint: 'Work with the projects you have created or scanned.',
    commands: [
      { say: '“Open project HQ”', does: 'Opens HQ for the active project' },
      { say: '“Open HQ for ‹project›”', does: 'Opens HQ for a named project' },
      { say: '“Review ‹project›”', does: 'Opens a project for review' },
      { say: '“Run council review”', does: 'Starts a council review for the active project' },
      { say: '“Generate launch plan”', does: 'Creates a launch plan for the active project' },
      { say: '“Deep index ‹project›”', does: 'Re-indexes a project’s files' },
      { say: '“Open active project”', does: 'Opens the most recent project' },
    ],
  },
  {
    id: 'offices',
    label: 'Office & employee commands',
    hint: 'Offices, departments and the agents inside them.',
    commands: [
      { say: '“Open office ‹name›”', does: 'Opens a specific office' },
      { say: '“Open ‹agent name›”', does: 'Opens that agent inside Offices' },
      { say: '“Create agent”', does: 'Opens Offices ready to add an agent' },
      { say: '“Assign agent to ‹office›”', does: 'Starts assigning an agent' },
    ],
  },
  {
    id: 'brain',
    label: 'Brain commands',
    hint: 'Memory, knowledge and pending agent reports.',
    commands: [
      { say: '“Show brain” / “Open brain”', does: 'Opens the Brain core modal' },
      { say: '“Show pending reports”', does: 'Opens Brain on agent reports' },
    ],
  },
  {
    id: 'quick',
    label: 'Quick actions',
    hint: 'Fast one-shot commands — no modal needed.',
    commands: [
      { say: '”New chat” / “New session”', does: 'Starts a fresh conversation' },
      { say: '”Close all” / “Close everything”', does: 'Closes all open panels at once' },
      { say: '”Help” / “What can I say”', does: 'Opens this cheat sheet' },
      { say: '”What time is it”', does: 'Reads back the current time' },
      { say: '”What's the date” / “What day is it”', does: 'Reads back today's date' },
      { say: '”Mute” / “Pause listening”', does: 'Pauses the microphone (say “Hey Cerberus” to resume)' },
      { say: '”Read that back” / “Say that again”', does: 'Re-reads Cerberus\'s last spoken reply' },
      { say: '”Dark mode” / “Light mode”', does: 'Switches the UI theme' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance commands',
    hint: 'Log income and check what you owe — without opening the Finance modal.',
    commands: [
      { say: '”Log a full day” / “Log a half day”', does: 'Logs a work day to your income tracker' },
      { say: '”How much do I owe this week”', does: 'Reads back your total bills due this week' },
    ],
  },
  {
    id: 'tasks',
    label: 'Task commands',
    hint: 'Create and query your scheduled tasks by voice.',
    commands: [
      { say: '”Add task ‹description›”', does: 'Creates a new task with that description' },
      { say: '”What are my tasks” / “List tasks”', does: 'Reads back your top 5 active tasks' },
    ],
  },
  {
    id: 'agents',
    label: 'Agent shortcuts',
    hint: 'Message and check on agents in your offices.',
    commands: [
      { say: '”Message ‹agent› ‹message›”', does: 'Sends a message directly to a named agent' },
      { say: '”What\'s ‹agent› working on”', does: 'Reads back the agent\'s current status' },
    ],
  },
  {
    id: 'tools',
    label: 'Tool commands',
    hint: 'Quick actions inside the overlay tools.',
    commands: [
      { say: '”Close notes” / “Close calendar” …', does: 'Closes that tool' },
      { say: '”Close” / “Dismiss”', does: 'Closes the top-most modal' },
    ],
  },
  {
    id: 'desktop',
    label: 'Desktop bridge / app launch',
    hint: 'Available when the optional desktop bridge is configured in Settings → Desktop Bridge.',
    commands: [
      { say: '”Open ‹app›”', does: 'Launches an app you configured on the bridge' },
      { say: '”Open project in ‹editor›”', does: 'Opens the active project folder in your editor' },
    ],
  },
  {
    id: 'system',
    label: 'System commands',
    hint: 'Voice session and workspace control.',
    commands: [
      { say: '”Stop speaking”', does: 'Interrupts Cerberus speech' },
      { say: '”Refresh workspace”', does: 'Reloads projects, agents and briefing data' },
      { say: '”Continue”', does: 'Resumes after a pause' },
    ],
  },
];

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderVoiceCheatSheet() {
  const body = document.getElementById('cerberus-voice-cheatsheet-body');
  if (!body || body.dataset.rendered) return;
  body.dataset.rendered = '1';

  body.innerHTML = `
    <p class="cerberus-cheatsheet-intro">
      Say <strong>”Cerberus …”</strong> followed by any command below, or type it into the Assistant.
      Unknown commands show a notification — they never interrupt you.
    </p>
    ${COMMAND_GROUPS.map((g) => `
      <section class="cerberus-cheatsheet-group" data-cheat-group="${g.id}">
        <h3 class="cerberus-cheatsheet-group-title">${_esc(g.label)}</h3>
        <p class="cerberus-cheatsheet-group-hint">${_esc(g.hint)}</p>
        <table class="cerberus-cheatsheet-table">
          <tbody>
            ${g.commands.map((c) => `
              <tr>
                <td class="cerberus-cheatsheet-say">${_esc(c.say)}</td>
                <td class="cerberus-cheatsheet-does">${_esc(c.does)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>
    `).join('')}
  `;
}

const cerberusVoiceCheatSheet = { renderVoiceCheatSheet };
export default cerberusVoiceCheatSheet;
