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
      { say: '”Go to home”', does: 'Returns to the Cerberus home view' },
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
    id: 'tools',
    label: 'Tool commands',
    hint: 'Quick actions inside the overlay tools.',
    commands: [
      { say: '“Close notes” / “Close calendar” …', does: 'Closes that tool' },
      { say: '“Close” / “Dismiss”', does: 'Closes the top-most modal' },
    ],
  },
  {
    id: 'desktop',
    label: 'Desktop bridge / app launch',
    hint: 'Available when the optional desktop bridge is configured in Settings → Desktop Bridge.',
    commands: [
      { say: '“Open ‹app›”', does: 'Launches an app you configured on the bridge' },
      { say: '“Open project in ‹editor›”', does: 'Opens the active project folder in your editor' },
    ],
  },
  {
    id: 'system',
    label: 'System commands',
    hint: 'Voice session and workspace control.',
    commands: [
      { say: '”Stop speaking”', does: 'Interrupts Cerberus speech' },
      { say: '“Refresh workspace”', does: 'Reloads projects, agents and briefing data' },
      { say: '“Continue”', does: 'Resumes after a pause' },
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
