const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const tabs = document.getElementById("tabs");
const cancel = document.getElementById("cancel");

let sources = [];
let tab = "window";

function render() {
  const shown = sources.filter((source) => (tab === "screen" ? source.screen : !source.screen));
  grid.replaceChildren();
  empty.hidden = shown.length > 0;

  for (const source of shown) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    card.title = source.name;
    card.addEventListener("click", () => window.jotboxPicker.pick(source.id));

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (source.thumbnail) {
      const image = document.createElement("img");
      image.src = source.thumbnail;
      image.alt = "";
      thumb.append(image);
    }
    card.append(thumb);

    const name = document.createElement("div");
    name.className = "name";
    if (source.icon) {
      const icon = document.createElement("img");
      icon.src = source.icon;
      icon.alt = "";
      name.append(icon);
    }
    const text = document.createElement("span");
    text.textContent = source.name;
    name.append(text);
    card.append(name);

    grid.append(card);
  }
}

window.jotboxPicker.onSources((next) => {
  sources = Array.isArray(next) ? next : [];
  const firstWindow = sources.find((source) => !source.screen);
  tab = firstWindow ? "window" : "screen";
  for (const button of tabs.querySelectorAll(".tab")) {
    button.classList.toggle("on", button.dataset.tab === tab);
  }
  render();
});

tabs.addEventListener("click", (event) => {
  const button = event.target.closest(".tab");
  if (!button) return;
  tab = button.dataset.tab;
  for (const item of tabs.querySelectorAll(".tab")) {
    item.classList.toggle("on", item === button);
  }
  render();
});

cancel.addEventListener("click", () => window.jotboxPicker.cancel());
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.jotboxPicker.cancel();
});
