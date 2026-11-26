// The demo content of the documentation pictures: "Acme Notes", an invented app, with invented people and clearly marked
// example data. No real brand, person, address or account is used:
//   - e-mail addresses end in .example (reserved, RFC 2606);
//   - phone numbers are in the 555-01xx range that is reserved for fiction;
//   - the IBAN is the example of the German IBAN specification, the card number a public payment test number.
// Every page is plain HTML with system fonts, shown in a window of the test instance. Elements with `data-mark` are measured,
// so that annotations and clicks land on them.

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden}
body{font:15px/1.45 "Segoe UI",system-ui,sans-serif;color:#1f2433;background:#f5f6fb;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:14px;height:56px;padding:0 20px;background:#fff;border-bottom:1px solid #e3e5f0;flex:none}
.logo{width:30px;height:30px;border-radius:9px;background:#4f46e5;color:#fff;display:grid;place-items:center;font-weight:700;font-size:17px}
.brand{font-weight:700;font-size:17px}
.search{margin-inline-start:auto;width:240px;padding:7px 12px;border-radius:8px;background:#f1f2f8;color:#747a91;font-size:14px}
.avatar{width:32px;height:32px;border-radius:50%;background:#0f9d8a;color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600}
.shell{display:flex;flex:1;min-height:0}
nav{width:168px;flex:none;background:#fff;border-inline-end:1px solid #e3e5f0;padding:14px 10px;display:flex;flex-direction:column;gap:2px}
nav button{font:inherit;text-align:start;border:0;background:none;padding:8px 12px;border-radius:8px;color:#434a63;cursor:default}
nav button[aria-current]{background:#eceafd;color:#3b32c4;font-weight:600}
main{flex:1;min-width:0;padding:22px 28px;display:flex;flex-direction:column;gap:16px}
h1{font-size:23px}
.row{display:flex;align-items:center;gap:12px}
.grow{flex:1}
.btn{font:inherit;font-weight:600;font-size:14px;padding:8px 16px;border-radius:8px;border:1px solid #d5d8e8;background:#fff;color:#2a3046;cursor:default}
.btn.primary{background:#4f46e5;border-color:#4f46e5;color:#fff}
.card{background:#fff;border:1px solid #e3e5f0;border-radius:12px;padding:16px 18px}
.muted{color:#6b7189;font-size:13.5px}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e3e5f0;border-radius:12px;overflow:hidden}
th,td{text-align:start;padding:11px 16px;border-bottom:1px solid #eceef6}
th{font-size:13px;color:#6b7189;font-weight:600;background:#fafbfe}
.cols{display:flex;gap:18px;flex:1;min-height:0}
.list{width:250px;flex:none;display:flex;flex-direction:column;gap:10px}
.note{background:#fff;border:1px solid #e3e5f0;border-radius:10px;padding:11px 14px}
.note b{display:block;font-size:14.5px}
.note.on{border-color:#4f46e5;box-shadow:0 0 0 2px #4f46e533}
.paper{flex:1;background:#fff;border:1px solid #e3e5f0;border-radius:12px;padding:22px 26px;display:flex;flex-direction:column;gap:12px;min-width:0}
.paper h2{font-size:20px}
ul{padding-inline-start:20px;display:flex;flex-direction:column;gap:6px}
label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:#6b7189;font-weight:600}
input,textarea{font:inherit;color:#1f2433;border:1px solid #cfd3e6;border-radius:8px;padding:9px 12px;background:#fff;resize:none}
.toast{position:fixed;inset-inline-end:22px;bottom:22px;background:#1f2433;color:#fff;border-radius:10px;padding:12px 18px;font-weight:600}
.veil{position:fixed;inset:0;background:#1f243355;display:grid;place-items:center}
.dialog{width:420px;background:#fff;border-radius:14px;padding:22px 24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 18px 60px #0003}
.tag{font-size:12px;font-weight:600;padding:2px 9px;border-radius:99px;background:#fff3cd;color:#7a5800}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.stats .card b{display:block;font-size:30px}
.chart{flex:1;display:flex;align-items:flex-end;gap:26px;padding:24px 30px 16px}
.bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:8px;height:100%}
.bar i{display:block;width:100%;border-radius:8px 8px 0 0;background:#4f46e5}
.board{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;flex:1}
.lane{background:#eceef7;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px}
.lane h3{font-size:14px;color:#434a63}
.lines{display:flex;flex-direction:column;gap:12px;font-size:17px}
`;

const NAV = ["Notes", "Team", "Tasks", "Activity", "Billing"];

function shell(current, body, extra = "") {
  const nav = NAV.map((n) => `<button ${n === current ? 'aria-current="page"' : ""} data-mark="nav-${n.toLowerCase()}">${n}</button>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme Notes</title><style>${CSS}</style></head><body>
<header><span class="logo" aria-hidden="true">A</span><span class="brand">Acme Notes</span><span class="search">Search notes</span><span class="avatar" aria-hidden="true">ME</span></header>
<div class="shell"><nav aria-label="Sections">${nav}</nav><main>${body}</main></div>${extra}</body></html>`;
}

const noteList = (first = "") => `<div class="list">${first}
<div class="note${first ? "" : " on"}"><b>Sprint planning</b><span class="muted">Monday · 4 items</span></div>
<div class="note"><b>Release checklist</b><span class="muted">Friday · draft</span></div>
<div class="note"><b>Onboarding guide</b><span class="muted">Last week</span></div>
<div class="note"><b>Offsite ideas</b><span class="muted">Last month</span></div></div>`;

const notes = () =>
  shell(
    "Notes",
    `<div class="row"><h1>Team notebook</h1><span class="grow"></span><button class="btn" data-mark="share">Share</button><button class="btn primary" data-mark="new-note">New note</button></div>
<div class="cols">${noteList()}<div class="paper" data-mark="paper"><h2 data-mark="title">Sprint planning</h2><p class="muted">Edited by Mia Example</p>
<ul><li data-mark="li1">Ship the new export dialog</li><li data-mark="li2">Write the getting started page</li><li data-mark="li3">Test on a second screen</li><li data-mark="li4">Plan the next release</li></ul>
<p data-mark="question"><b>Open question:</b> do we keep the old keyboard shortcut?</p></div></div>`,
  );

const editor = (title = "", text = "", saved = false) =>
  shell(
    "Notes",
    `<div class="row"><h1>Team notebook</h1><span class="grow"></span><button class="btn" data-mark="share">Share</button><button class="btn primary" data-mark="new-note">New note</button></div>
<div class="cols">${noteList(`<div class="note on"><b>${title || "Untitled note"}</b><span class="muted">Just now</span></div>`)}<div class="paper">
<label>Title<input aria-label="Title" data-mark="title-field" value="${title}" placeholder="Name the note"></label>
<label>Note<textarea aria-label="Note" data-mark="note-field" rows="7" placeholder="Start typing">${text}</textarea></label>
<div class="row"><span class="grow"></span><button class="btn primary" data-mark="save">Save note</button></div></div></div>`,
    saved ? `<div class="toast">Note saved</div>` : "",
  );

const share = (email = "") =>
  shell(
    "Notes",
    `<div class="row"><h1>Team notebook</h1><span class="grow"></span><button class="btn">Share</button><button class="btn primary">New note</button></div>
<div class="cols">${noteList()}<div class="paper"><h2>Release checklist</h2></div></div>`,
    `<div class="veil"><div class="dialog" role="dialog" aria-label="Share note"><h2>Share note</h2>
<label>E-mail address<input aria-label="E-mail address" data-mark="email-field" value="${email}" placeholder="name@acme-notes.example"></label>
<div class="row"><span class="grow"></span><button class="btn">Cancel</button><button class="btn primary" data-mark="invite">Send invite</button></div></div></div>`,
  );

const PEOPLE = [
  ["Mia Example", "Design", "mia@acme-notes.example", "+1 202 555 0143"],
  ["Jonas Sample", "Development", "jonas@acme-notes.example", "+1 202 555 0167"],
  ["Priya Placeholder", "Support", "priya@acme-notes.example", "+1 202 555 0182"],
  ["Leo Fictional", "Marketing", "leo@acme-notes.example", "+1 202 555 0119"],
];

const team = () =>
  shell(
    "Team",
    `<div class="row"><h1>Team directory</h1><span class="tag">Example data</span><span class="grow"></span><button class="btn primary" data-mark="invite">Invite person</button></div>
<table data-mark="table"><thead><tr><th>Name</th><th>Team</th><th>E-mail</th><th>Phone</th></tr></thead><tbody>
${PEOPLE.map((p, i) => `<tr data-mark="person${i}">${p.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>
<div class="card" data-mark="contact">Questions? Write to <b>support@acme-notes.example</b> or call <b>+1 202 555 0188</b>.</div>`,
  );

const billing = () =>
  shell(
    "Billing",
    `<div class="row"><h1>Payment details</h1><span class="tag">Example data, not real</span><span class="grow"></span><button class="btn" data-mark="download">Download invoice</button></div>
<div class="card lines" data-mark="details">
<p>Account holder: Jonas Sample</p>
<p data-mark="mail">E-mail: billing@acme-notes.example</p>
<p data-mark="phone">Phone: +1 202 555 0188</p>
<p data-mark="iban">IBAN: DE89 3704 0044 0532 0130 00</p>
<p data-mark="card">Card number: 5555 5555 5555 4444</p>
<p data-mark="password">Password: Demo-Only-4821</p></div>
<p class="muted">All values on this page are invented examples and test numbers.</p>`,
  );

const tasks = () => {
  const lane = (name, items) => `<div class="lane"><h3>${name}</h3>${items.map(([t, s]) => `<div class="note"><b>${t}</b><span class="muted">${s}</span></div>`).join("")}</div>`;
  return shell(
    "Tasks",
    `<div class="row"><h1>Release board</h1><span class="grow"></span><button class="btn primary">Add task</button></div><div class="board" data-mark="board">
${lane("To do", [["Update screenshots", "Mia"], ["Translate the guide", "Priya"], ["Check dark theme", "Leo"]])}
${lane("In progress", [["Export dialog", "Jonas"], ["Help pages", "Mia"]])}
${lane("Done", [["New logo", "Leo"], ["Installer", "Jonas"], ["Keyboard shortcuts", "Priya"]])}</div>`,
  );
};

const activity = () =>
  shell(
    "Activity",
    `<div class="row"><h1>Weekly activity</h1><span class="grow"></span><button class="btn">This week</button></div>
<div class="stats"><div class="card"><b>128</b><span class="muted">Notes created</span></div><div class="card" data-mark="stat2"><b>42</b><span class="muted">Notes shared</span></div><div class="card"><b>7</b><span class="muted">Active people</span></div></div>
<div class="card chart" data-mark="chart">${[["Mon", 52], ["Tue", 68], ["Wed", 91], ["Thu", 74], ["Fri", 83], ["Sat", 24], ["Sun", 18]]
      .map(([d, v]) => `<div class="bar"><i style="height:${v}%" data-mark="bar-${d.toLowerCase()}"></i><span class="muted">${d}</span></div>`)
      .join("")}</div>`,
  );

/** Every page of the demo app, by name. */
export const PAGES = {
  notes,
  team,
  billing,
  tasks,
  activity,
  editor: () => editor(),
  titled: () => editor("Release checklist"),
  written: () => editor("Release checklist", "Build, test on a clean PC, then publish."),
  saved: () => editor("Release checklist", "Build, test on a clean PC, then publish.", true),
  kept: () => editor("Release checklist", "", true),
  share: () => share(),
  invited: () => share("priya@acme-notes.example"),
};

/** An invented desktop for the capture overlay: a plain wallpaper with the demo app's window on it. */
export const desktop = (picture) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;font:15px "Segoe UI",sans-serif}
body{background:linear-gradient(135deg,#cfe8ff,#e6dcff 55%,#ffe3d3);position:relative}
.win{position:absolute;left:300px;top:96px;width:1280px;border-radius:12px;overflow:hidden;box-shadow:0 30px 80px #0004;background:#fff}
.bar{height:38px;background:#e9eaf3;display:flex;align-items:center;padding:0 14px;gap:8px;color:#434a63;font-size:13.5px}
.win img{display:block;width:1280px;height:800px}
.task{position:absolute;left:0;right:0;bottom:0;height:52px;background:#ffffffd0;display:flex;justify-content:center;align-items:center;gap:12px}
.task i{width:30px;height:30px;border-radius:7px;background:#4f46e5}.task i:nth-child(2){background:#0f9d8a}.task i:nth-child(3){background:#e8833a}</style></head>
<body><div class="win"><div class="bar">Acme Notes — demo window</div><img src="${picture}" alt=""></div><div class="task"><i></i><i></i><i></i></div></body></html>`;
