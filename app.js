(function () {
  const WF = window.WF;
  const state = {
    gnosis: 5,
    mysterium: "auto",
    style: "populaire",
    elements: [],
    weapon: "",
    sort: "score",
    scoreCut: "all",
    attrs: { flesh: 100, blood: 100, mind: 100, witchery: 100, arsenal: 100, faith: 100 },
    onlyCovered: false,
    showLocked: false,
    onlyFav: false,
    tab: "builds",
    open: null,
    result: null,
    vault: loadVault(),
    sims: {},
    draft: null,
    flash: null,
    draftNotice: "",
    vaultFile: false,
  };
  let vaultEpoch = 0;
  let filterEpoch = 0;
  let vaultReady = false;
  let filterTimer = 0;
  let repaintAttrFilters = () => {};
  const SLOTS = ["primary", "secondary", "demonic", "melee", "light", "heavy", "relic", "ring", "fetish"];
  const SLOT_LABELS = {
    primary: "Arme principale",
    secondary: "Arme secondaire",
    demonic: "Arme démoniaque",
    melee: "Mêlée",
    light: "Sort léger",
    heavy: "Sort lourd",
    relic: "Relique",
    ring: "Anneau",
    fetish: "Fétiche",
  };

  const $ = (id) => document.getElementById(id);
  const phases = [
    { id: "debut", label: "Début", gnosis: 1 },
    { id: "milieu", label: "Milieu", gnosis: 3 },
    { id: "fin", label: "Fin", gnosis: 5 },
  ];
  const elementIds = ["fire", "earth", "air", "water"];

  function run() {
    const started = performance.now();
    state.result = WF.recommend({
      gnosis: state.gnosis,
      mysterium: state.mysterium,
      style: state.style,
      elements: state.elements,
      weapon: state.weapon,
      attrs: state.attrs,
      onlyCovered: state.onlyCovered,
      showLocked: state.showLocked,
    });
    const ms = Math.round(performance.now() - started);
    renderStatus(ms);
    renderBuilds();
    if (state.open) {
      const still = state.result.builds.find((b) => b.id === state.open)
        || state.result.locked.find((b) => b.id === state.open)
        || customCards().find((b) => b.id === state.open);
      if (still) renderDetail(still);
      else closeDetail();
    }
  }

  function paintRange(input) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value || 0);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty("--fill", `${pct.toFixed(2)}%`);
  }

  function wireRange(input) {
    input.addEventListener("input", () => paintRange(input));
    paintRange(input);
    return input;
  }

  function renderStatus(ms) {
    const r = state.result;
    $("gnosis-value").textContent = String(r.gnosis);
    paintRange($("gnosis"));
    $("gnosis-hint").textContent = `${r.phase.name} de partie · ${r.slots} perle${r.slots > 1 ? "s" : ""} de rosaire.`;
    const status = $("status");
    status.replaceChildren();
    const bits = [
      [String(r.builds.length), r.builds.length > 1 ? "combinaisons retenues" : "combinaison retenue"],
      [r.phase.name, "de partie"],
      [`Mysterium ${r.mysterium}`, ""],
      [String(r.slots), r.slots > 1 ? "perles de rosaire" : "perle de rosaire"],
      [`${ms} ms`, "de calcul"],
    ];
    if (r.hiddenHints) bits.push([String(r.hiddenHints), r.hiddenHints > 1 ? "rosaires masqués" : "rosaire masqué"]);
    for (const [value, label] of bits) {
      const item = document.createElement("span");
      item.className = "status-item";
      const strong = document.createElement("b");
      strong.textContent = value;
      item.appendChild(strong);
      if (label) item.append(` ${label}`);
      status.appendChild(item);
    }
  }

  function sortedBuilds() {
    const list = state.result.builds.slice();
    if (state.sort === "combo") list.sort((a, b) => (b.math.package || b.math.comboTotal || 0) - (a.math.package || a.math.comboTotal || 0));
    else if (state.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "fr"));
    else list.sort((a, b) => b.score - a.score);
    return list;
  }

  function keepByScore(list, reference) {
    if (state.scoreCut === "all") return list.slice();
    const ranked = reference.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    if (!ranked.length) return [];
    if (state.scoreCut === "top5" || state.scoreCut === "top8") {
      const count = state.scoreCut === "top5" ? 5 : 8;
      const ids = new Set(ranked.slice(0, count).map((build) => build.id));
      return list.filter((build) => ids.has(build.id));
    }
    const best = ranked[0].score || 0;
    const floor = best * (state.scoreCut === "near" ? 0.8 : 0.5);
    return list.filter((build) => (build.score || 0) >= floor);
  }

  function renderBuilds() {
    const root = $("builds");
    root.innerHTML = "";
    const mine = customCards().filter((build) => !state.onlyFav || isFav(build));
    if (mine.length) {
      root.appendChild(sectionTitle("Mes équipements"));
      for (const build of mine) root.appendChild(card(build, false));
    }
    const known = new Set(mine.map((build) => build.id).concat(state.result.builds.map((build) => build.id), state.result.locked.map((build) => build.id)));
    const outside = state.vault.favorites.filter((entry) => !known.has(entry.id)).map((entry) => {
      try { return WF.present(entry); } catch (err) { return null; }
    }).filter(Boolean);
    if (outside.length) {
      root.appendChild(sectionTitle("Favoris hors de ce filtre"));
      for (const build of outside) root.appendChild(card(build, false));
    }
    const pool = sortedBuilds().filter((build) => !state.onlyFav || isFav(build));
    const list = keepByScore(pool, pool);
    if (state.scoreCut !== "all" && pool.length) {
      const note = document.createElement("p");
      note.className = "filter-note score-note";
      const aside = pool.length - list.length;
      note.textContent = aside
        ? `${list.length} retenu${list.length > 1 ? "s" : ""} par le score, ${aside} laissé${aside > 1 ? "s" : ""} de côté.`
        : "Tous les builds de la liste passent ce seuil de score.";
      root.appendChild(note);
    }
    if (list.length) {
      if (state.style === "populaire") root.appendChild(sectionTitle("Populaires"));
      else if (state.style === "notable") root.appendChild(sectionTitle("Notables"));
      else if (mine.length || outside.length) root.appendChild(sectionTitle("Proposés par le moteur"));
      for (const build of list) root.appendChild(card(build, false));
    } else if (state.onlyFav && !mine.length && !outside.length) {
      const empty = document.createElement("p");
      empty.textContent = "Aucun favori pour ce filtre.";
      root.appendChild(empty);
    } else if (state.scoreCut !== "all" && pool.length) {
      const empty = document.createElement("p");
      empty.textContent = "Aucun build n'atteint ce score.";
      root.appendChild(empty);
    }
    const wrap = $("locked-wrap");
    wrap.innerHTML = "";
    const locked = keepByScore(state.result.locked, pool.length ? pool : state.result.locked);
    if (!state.onlyFav && locked.length) {
      const title = document.createElement("h2");
      title.textContent = "Encore verrouillés à ce Gnosis";
      wrap.appendChild(title);
      const grid = document.createElement("div");
      grid.className = "cards";
      for (const build of locked) grid.appendChild(card(build, true));
      wrap.appendChild(grid);
    }
    if (state.open && !list.some((build) => build.id === state.open) && !mine.some((build) => build.id === state.open) && !outside.some((build) => build.id === state.open) && !locked.some((build) => build.id === state.open)) {
      closeDetail();
    }
  }

  function card(build, locked) {
    const btn = document.createElement("article");
    btn.className = "card" + (locked ? " locked" : "") + (state.open === build.id ? " is-open" : "");
    btn.tabIndex = 0;
    btn.setAttribute("role", "button");
    if (build.elements[0]) btn.dataset.accent = build.elements[0].id;
    const head = document.createElement("div");
    head.className = "card-head";
    const h = document.createElement("h2");
    h.textContent = build.name;
    head.appendChild(h);
    head.appendChild(scoreBlock(build.score));
    const tools = document.createElement("div");
    tools.className = "card-tools";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "text-btn";
    edit.textContent = "Modifier";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      openInAtelier(build);
    });
    tools.appendChild(edit);
    tools.appendChild(starButton(build));
    head.append(tools);
    btn.appendChild(head);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.appendChild(badge(build.phase, "phase"));
    meta.appendChild(badge(`Gnosis ${build.gnosis}`, ""));
    const comboShown = build.math.package || build.math.comboTotal;
    if (comboShown) meta.appendChild(badge(`Combo ${WF.fmt(comboShown)}`, "score"));
    for (const el of build.elements) meta.appendChild(badge(el.name, el.id));
    for (const node of playBadges(build)) meta.appendChild(node);
    if (build.custom) meta.appendChild(badge("Personnel", ""));
    if (build.community && build.cited !== false) meta.appendChild(badge("Cité en ligne", ""));
    btn.appendChild(meta);
    const p = document.createElement("p");
    p.className = "blurb";
    p.textContent = (build.community || build.custom) && build.blurb ? build.blurb : build.note;
    btn.appendChild(p);
    const gear = document.createElement("div");
    gear.className = "gear";
    for (const [label, key] of [["Arme", "primary"], ["Secondaire", "secondary"], ["Démoniaque", "demonic"], ["Mêlée", "melee"], ["Léger", "light"], ["Lourd", "heavy"], ["Relique", "relic"], ["Anneau", "ring"], ["Fétiche", "fetish"]]) {
      gear.appendChild(gearCell(label, build.loadout[key]));
    }
    btn.appendChild(gear);
    if (build.beads.length) {
      btn.appendChild(beadRow(build.beads));
      appendGate(btn, build);
    }
    if (build.sources && build.sources.length && build.community) btn.appendChild(sourceLinks(build.sources));
    const open = () => renderDetail(build);
    btn.addEventListener("click", open);
    btn.addEventListener("keydown", (event) => {
      if (event.target !== btn) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    return btn;
  }

  function sourceLinks(sources) {
    const links = document.createElement("div");
    links.className = "card-links";
    for (const source of sources) {
      const a = document.createElement("a");
      a.href = source.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = source.label;
      a.addEventListener("click", (event) => event.stopPropagation());
      links.appendChild(a);
    }
    return links;
  }

  const GLYPH = {
    fire: "M8.1 1c.3 2.5-.7 3.7.5 5.4 1.1 1.5.5 3.7-1.7 5-2.5-1-3.6-3-2.7-4.8.4 1.4 1.5 1.7 1.5.1C6.2 5 7 2.8 8.1 1z",
    water: "M8 1.4C8 1.4 3.7 6.2 3.7 9.4a4.3 4.3 0 0 0 8.6 0C12.3 6.2 8 1.4 8 1.4z",
    air: "M9.3 1 3.9 8.1h3.5L6.3 15 12.2 7H8.6L9.3 1z",
    earth: "M8 1.3 12.8 4.8 11.2 14.2H4.8L3.2 4.8 8 1.3z",
  };

  function elementGlyph(id) {
    const known = window.WF_DATA.EL[id];
    const name = known ? known.name : id;
    const span = document.createElement("span");
    span.className = "el-mark " + id;
    span.title = name;
    span.setAttribute("role", "img");
    span.setAttribute("aria-label", name);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", GLYPH[id] || "");
    svg.appendChild(path);
    span.appendChild(svg);
    return span;
  }

  function elementMarks(ids) {
    const list = (ids || []).filter((id) => GLYPH[id]);
    if (!list.length) return null;
    const wrap = document.createElement("span");
    wrap.className = "el-marks";
    for (const id of list) wrap.appendChild(elementGlyph(id));
    return wrap;
  }

  const PLAY_LABELS = [
    ["elementaire", "Élémentaire"],
    ["foules", "Foules"],
    ["boss", "Boss et élites"],
    ["distance", "Distance"],
    ["corps", "Corps à corps"],
    ["survie", "Survie"],
    ["tir", "Tir pur"],
    ["notable", "Notable"],
  ];

  function playBadges(build) {
    const tags = build.tags || [];
    return PLAY_LABELS.filter(([id]) => tags.includes(id)).map(([id, label]) => badge(label, "play"));
  }

  function badge(text, cls) {
    const span = document.createElement("span");
    span.className = "badge " + (cls || "");
    if (GLYPH[cls]) span.appendChild(elementGlyph(cls));
    span.appendChild(document.createTextNode(text));
    return span;
  }

  function scoreBlock(score) {
    const box = document.createElement("div");
    box.className = "card-score";
    const value = document.createElement("b");
    value.textContent = String(score);
    const label = document.createElement("span");
    label.textContent = "score";
    box.append(value, label);
    return box;
  }

  function renderDetail(build) {
    state.open = build.id;
    const root = $("detail");
    root.hidden = false;
    $("view-builds").classList.add("with-detail");
    root.innerHTML = "";
    if (build.elements[0]) root.dataset.accent = build.elements[0].id;
    else delete root.dataset.accent;
    const detailHead = document.createElement("div");
    detailHead.className = "detail-head";
    const h = document.createElement("h2");
    h.textContent = build.name;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close-btn";
    close.textContent = "×";
    close.setAttribute("aria-label", "Fermer le détail");
    close.addEventListener("click", () => {
      closeDetail();
      renderBuilds();
    });
    detailHead.append(h, scoreBlock(build.score), close);
    root.appendChild(detailHead);
    const detailMeta = document.createElement("div");
    detailMeta.className = "meta";
    for (const el of build.elements) detailMeta.appendChild(badge(el.name, el.id));
    for (const node of playBadges(build)) detailMeta.appendChild(node);
    if (detailMeta.childElementCount) root.appendChild(detailMeta);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const saved = findSaved(build);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary";
    if (build.custom) save.textContent = "Enregistrer";
    else if (saved) save.textContent = "Copie déjà enregistrée";
    else save.textContent = "Enregistrer une copie";
    save.disabled = !build.custom && !!saved;
    save.addEventListener("click", () => {
      const entry = saveBuild(build);
      state.flash = { id: build.id, text: savedMessage(build.custom ? "Modifications enregistrées." : `Copie enregistrée : « ${entry.name} ».`) };
      renderBuilds();
      const fresh = customCards().find((item) => item.id === build.id) || build;
      renderDetail(fresh);
    });
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = !build.custom && saved ? "Modifier la copie" : "Modifier";
    edit.addEventListener("click", () => openInAtelier(build));
    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "fav-label";
    fav.textContent = isFav(build) ? "Retirer des favoris" : "Mettre en favori";
    fav.addEventListener("click", () => {
      toggleFav(build);
      renderBuilds();
      renderDetail(build);
    });
    actions.append(save, edit, fav);
    if (build.custom) {
      const drop = document.createElement("button");
      drop.type = "button";
      drop.textContent = "Supprimer";
      drop.addEventListener("click", () => {
        if (!window.confirm("Supprimer cet équipement enregistré ?")) return;
        deleteCustom(build.id);
      });
      actions.appendChild(drop);
    }
    root.appendChild(actions);
    if (state.flash && state.flash.id === build.id) {
      const note = document.createElement("p");
      note.className = "notice";
      note.textContent = state.flash.text;
      root.appendChild(note);
    }
    const lead = document.createElement("p");
    lead.textContent = (build.community || build.custom) && build.blurb ? build.blurb : build.note;
    root.appendChild(lead);

    const hGear = document.createElement("h3");
    hGear.textContent = "Équipement et chiffres";
    root.appendChild(hGear);
    for (const [label, key] of [["Arme principale", "primary"], ["Arme secondaire", "secondary"], ["Arme démoniaque", "demonic"], ["Mêlée", "melee"], ["Sort léger", "light"], ["Sort lourd", "heavy"], ["Relique", "relic"], ["Anneau", "ring"], ["Fétiche", "fetish"]]) {
      root.appendChild(slotBlock(label, build.loadout[key]));
    }
    const hBeads = document.createElement("h3");
    hBeads.textContent = "Rosaire";
    root.appendChild(hBeads);
    if (build.beads.length) {
      root.appendChild(beadRow(build.beads, true));
      appendGate(root, build);
    } else {
      const emptyBeads = document.createElement("p");
      emptyBeads.textContent = "Aucune perle choisie.";
      root.appendChild(emptyBeads);
    }

    const hRot = document.createElement("h3");
    hRot.textContent = "Enchaînement";
    root.appendChild(hRot);
    const rot = document.createElement("p");
    rot.textContent = build.rotation;
    root.appendChild(rot);

    const hSim = document.createElement("h3");
    hSim.textContent = "Simulateur de dégâts";
    root.appendChild(hSim);
    const sim = simModel(build);
    root.appendChild(simPanel({
      loadout: build.loadout,
      beads: build.beads,
      mysterium: build.mysterium,
      attrs: sim.attrs,
      critRate: sim.critRate,
      gun: sim.gun,
      onGun: (value) => { sim.gun = value; },
      onCrit: (value) => { sim.critRate = value; },
    }, true));

    const hProof = document.createElement("h3");
    hProof.textContent = "Preuve";
    root.appendChild(hProof);
    for (const step of build.proof) {
      const block = document.createElement("p");
      block.className = "proof-step";
      const strong = document.createElement("strong");
      strong.textContent = step.title;
      const text = document.createElement("span");
      text.textContent = " " + step.text;
      block.append(strong, text);
      root.appendChild(block);
    }

    const hArc = document.createElement("h3");
    hArc.textContent = "Arcanes à prendre si la pioche les montre";
    root.appendChild(hArc);
    if (!build.arcana.lines.length) {
      const empty = document.createElement("p");
      empty.textContent = "Cet équipement n'ouvre aucun élément.";
      root.appendChild(empty);
    }
    for (const line of build.arcana.lines) {
      const p = document.createElement("p");
      p.className = "proof-step";
      const strong = document.createElement("strong");
      const markId = elementIds.find((id) => window.WF_DATA.EL[id].name === line.element);
      if (markId) strong.appendChild(elementGlyph(markId));
      strong.appendChild(document.createTextNode(line.element));
      p.appendChild(strong);
      const ul = document.createElement("span");
      ul.textContent = " " + line.picks.join(" · ");
      p.appendChild(ul);
      root.appendChild(p);
    }
    const prop = document.createElement("p");
    prop.textContent = build.arcana.locked
      ? "L'étude des prophéties s'ouvre au Gnosis IV. Avant cela, la pioche ne dépend que des éléments équipés."
      : `Prophéties qui favorisent cette pioche : ${build.arcana.prophecies.join(", ") || "aucune ligne élémentaire"}.`;
    root.appendChild(prop);

    const hSrc = document.createElement("h3");
    hSrc.textContent = "Sources";
    root.appendChild(hSrc);
    for (const source of build.sources) {
      const a = document.createElement("a");
      a.href = source.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = source.label;
      const p = document.createElement("p");
      p.appendChild(a);
      root.appendChild(p);
    }
    renderBuilds();
  }

  function wideArt(entry) {
    return !!(entry && (entry.slot === "weapon" || entry.slot === "demonic"));
  }

  function portraitLetter(entry) {
    const span = document.createElement("span");
    span.className = "portrait portrait-empty" + (wideArt(entry) ? " portrait-wide" : "");
    span.textContent = entry ? entry.name.slice(0, 1) : "—";
    return span;
  }

  function portrait(entry) {
    const raw = entry && window.WF_IMAGES && window.WF_IMAGES[entry.id];
    if (!raw) return portraitLetter(entry);
    const src = String(raw).split("?")[0];
    const img = document.createElement("img");
    img.className = "portrait" + (wideArt(entry) ? " portrait-wide" : "");
    img.alt = entry.name;
    img.addEventListener("error", () => {
      const tries = Number(img.dataset.tries || "0") + 1;
      img.dataset.tries = String(tries);
      if (tries > 2 || !img.isConnected) {
        img.replaceWith(portraitLetter(entry));
        return;
      }
      img.removeAttribute("src");
      setTimeout(() => {
        if (img.isConnected) img.src = src;
      }, 200 * tries);
    });
    img.src = src;
    return img;
  }

  function gearCell(label, entry) {
    const cell = document.createElement("div");
    cell.className = "gear-item";
    cell.appendChild(portrait(entry));
    const text = document.createElement("div");
    text.className = "gear-copy";
    const kind = document.createElement("span");
    kind.textContent = label;
    const name = document.createElement("b");
    name.className = "gear-name";
    const marks = elementMarks(entry && entry.elements);
    if (marks) name.appendChild(marks);
    const labelText = document.createElement("span");
    labelText.textContent = entry ? entry.name : "—";
    name.appendChild(labelText);
    text.append(kind, name);
    cell.appendChild(text);
    return cell;
  }

  const GATE_NAMES = [
    ["flesh", "Chair"],
    ["blood", "Sang"],
    ["mind", "Esprit"],
    ["witchery", "Sorcellerie"],
    ["arsenal", "Arsenal"],
    ["faith", "Foi"],
  ];

  function gatesOf(entry) {
    const gates = {};
    const byName = {};
    for (const [id, name] of GATE_NAMES) byName[name] = id;
    const re = /(Chair|Sang|Esprit|Sorcellerie|Arsenal|Foi)\s+(\d+)/g;
    let match;
    while ((match = re.exec((entry && entry.found) || ""))) gates[byName[match[1]]] = Number(match[2]);
    return gates;
  }

  function combinedGates(entries) {
    const need = {};
    for (const entry of entries) {
      for (const [id, value] of Object.entries(gatesOf(entry))) {
        if (!need[id] || value > need[id]) need[id] = value;
      }
    }
    return need;
  }

  function gateText(need) {
    return GATE_NAMES.filter(([id]) => need[id]).map(([id, name]) => `${name} ${need[id]}`).join(", ");
  }

  function gateNote(beads, attrs) {
    const need = combinedGates(beads);
    const asked = gateText(need);
    if (!asked) return null;
    const p = document.createElement("p");
    p.className = "gate";
    const limited = attrs && GATE_NAMES.some(([id]) => Number(attrs[id]) < 100);
    if (!limited) {
      p.textContent = `Ces perles demandent ${asked}.`;
      return p;
    }
    const short = GATE_NAMES
      .filter(([id]) => need[id] && Number(attrs[id] || 0) < need[id])
      .map(([id, name]) => `${name} ${attrs[id] || 0} pour ${need[id]}`);
    p.textContent = short.length
      ? `Ces perles demandent ${asked}. La transcendance est en dessous : ${short.join(", ")}.`
      : `Ces perles demandent ${asked}. La transcendance les couvre.`;
    return p;
  }

  function appendGate(parent, build) {
    const attrs = build.custom ? build.attrs : state.attrs;
    const gate = gateNote(build.beads, attrs);
    if (gate) parent.appendChild(gate);
    if (build.hintGap) {
      const gap = document.createElement("p");
      gap.className = "gate";
      gap.textContent = build.hintGap;
      parent.appendChild(gap);
    }
  }

  function beadRow(beads, withText) {
    const row = document.createElement("div");
    row.className = "bead-row" + (withText ? " bead-row-detail" : "");
    for (const bead of beads) {
      const chip = document.createElement("div");
      chip.className = "bead-chip";
      chip.title = `${bead.name} — ${bead.summary}`;
      chip.appendChild(portrait(bead));
      const name = document.createElement("span");
      name.textContent = bead.name.replace(" Bead", "").replace(" I", "");
      chip.appendChild(name);
      const asked = gateText(gatesOf(bead));
      if (withText && asked) {
        const req = document.createElement("small");
        req.className = "bead-gate";
        req.textContent = asked;
        chip.appendChild(req);
      }
      if (withText) {
        const sub = document.createElement("small");
        sub.textContent = bead.summary;
        chip.appendChild(sub);
      }
      row.appendChild(chip);
    }
    return row;
  }

  function slotBlock(label, entry) {
    const wrap = document.createElement("div");
    wrap.className = "slot";
    wrap.appendChild(portrait(entry));
    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    const marks = elementMarks(entry && entry.elements);
    if (marks) name.appendChild(marks);
    name.appendChild(document.createTextNode(entry ? `${label} — ${entry.name}` : `${label} — vide`));
    const sub = document.createElement("div");
    sub.className = "sub";
    if (entry) {
      const bits = [WF.statsLine(entry), entry.found || "", (entry.mysteria || []).join(" ")].filter(Boolean);
      sub.textContent = bits.join(" ");
      if (entry.url) {
        const a = document.createElement("a");
        a.href = entry.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = " Page du wiki";
        sub.appendChild(a);
      }
    }
    text.append(name, sub);
    wrap.appendChild(text);
    return wrap;
  }

  function closeDetail() {
    state.open = null;
    $("detail").hidden = true;
    $("view-builds").classList.remove("with-detail");
  }

  function setupFilters() {
    const phaseRow = $("phases");
    for (const phase of phases) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "phase";
      btn.textContent = phase.label;
      btn.dataset.gnosis = String(phase.gnosis);
      btn.addEventListener("click", () => {
        state.gnosis = phase.gnosis;
        $("gnosis").value = String(phase.gnosis);
        markPhases();
        rememberFilters();
        run();
      });
      phaseRow.appendChild(btn);
    }
    const box = $("elements");
    for (const id of elementIds) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip " + id;
      btn.dataset.element = id;
      btn.append(elementGlyph(id), document.createTextNode(window.WF_DATA.EL[id].name));
      btn.addEventListener("click", () => {
        if (state.elements.includes(id)) state.elements = state.elements.filter((el) => el !== id);
        else state.elements.push(id);
        btn.classList.toggle("is-on");
        rememberFilters();
        run();
      });
      box.appendChild(btn);
    }
    const weapon = $("weapon");
    const guns = WF.catalog().weapons.concat(WF.catalog().demonic, WF.catalog().melee).slice().sort((a, b) => a.name.localeCompare(b.name, "fr"));
    for (const gun of guns) {
      const opt = document.createElement("option");
      opt.value = gun.id;
      opt.textContent = `${gun.name} · Gnosis ${gun.gnosis}`;
      weapon.appendChild(opt);
    }
    $("gnosis").addEventListener("input", () => {
      state.gnosis = Number($("gnosis").value);
      markPhases();
      rememberFilters();
      run();
    });
    for (const id of ["mysterium", "style", "weapon", "sort"]) {
      $(id).addEventListener("change", () => {
        state[id] = $(id).value;
        rememberFilters();
        if (id === "sort") renderBuilds();
        else run();
      });
    }
    $("score-cut").addEventListener("change", () => {
      state.scoreCut = $("score-cut").value;
      rememberFilters();
      renderBuilds();
    });
    $("locked").addEventListener("change", () => {
      state.showLocked = $("locked").checked;
      rememberFilters();
      run();
    });
    $("only-fav").addEventListener("change", () => {
      state.onlyFav = $("only-fav").checked;
      rememberFilters();
      renderBuilds();
    });
    $("only-covered").addEventListener("change", () => {
      state.onlyCovered = $("only-covered").checked;
      rememberFilters();
      run();
    });
    const presets = $("attr-presets");
    const presetRows = [
      ["Sans limite", { flesh: 100, blood: 100, mind: 100, witchery: 100, arsenal: 100, faith: 100 }],
      ["Équilibré", { flesh: 40, blood: 40, mind: 40, witchery: 40, arsenal: 40, faith: 40 }],
      ["Début", { flesh: 15, blood: 15, mind: 15, witchery: 15, arsenal: 15, faith: 15 }],
      ["Sorcellerie", { flesh: 20, blood: 20, mind: 40, witchery: 90, arsenal: 20, faith: 40 }],
      ["Arsenal", { flesh: 20, blood: 40, mind: 25, witchery: 20, arsenal: 90, faith: 40 }],
    ];
    const attrBox = $("attr-filters");
    repaintAttrFilters = () => {
      attrBox.replaceChildren();
      attrBox.appendChild(attrFields(state.attrs, () => {
        rememberFilters();
        run();
      }));
    };
    for (const [label, attrs] of presetRows) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        state.attrs = Object.assign({}, attrs);
        rememberFilters();
        syncFilterControls();
        run();
      });
      presets.appendChild(btn);
    }
    $("rerun").addEventListener("click", run);
    syncFilterControls();
  }

  function emptyVault() {
    return { favorites: [], custom: [], filters: null };
  }

  function normalizeVault(raw) {
    if (!raw || typeof raw !== "object") return emptyVault();
    return {
      favorites: Array.isArray(raw.favorites) ? raw.favorites : [],
      custom: Array.isArray(raw.custom) ? raw.custom : [],
      filters: raw.filters && typeof raw.filters === "object" ? raw.filters : null,
    };
  }

  function normalizeFilters(raw) {
    if (!raw || typeof raw !== "object") return null;
    const styles = ["populaire", "toutes", "elementaire", "foules", "boss", "distance", "corps", "survie", "tir", "notable"];
    const sorts = ["score", "combo", "name"];
    const scoreCuts = ["all", "top5", "top8", "half", "near"];
    const mysteria = ["auto", "1", "2", "3"];
    const gnosis = Number(raw.gnosis);
    const attrs = { flesh: 100, blood: 100, mind: 100, witchery: 100, arsenal: 100, faith: 100 };
    for (const key of Object.keys(attrs)) {
      const value = Number(raw.attrs && raw.attrs[key]);
      if (Number.isFinite(value)) attrs[key] = Math.max(0, Math.min(100, Math.round(value)));
    }
    return {
      gnosis: Number.isFinite(gnosis) ? Math.max(0, Math.min(7, Math.round(gnosis))) : 5,
      mysterium: mysteria.includes(String(raw.mysterium)) ? String(raw.mysterium) : "auto",
      style: styles.includes(raw.style) ? raw.style : "populaire",
      elements: Array.isArray(raw.elements) ? raw.elements.filter((id) => elementIds.includes(id)) : [],
      weapon: typeof raw.weapon === "string" ? raw.weapon : "",
      sort: sorts.includes(raw.sort) ? raw.sort : "score",
      scoreCut: scoreCuts.includes(raw.scoreCut) ? raw.scoreCut : "all",
      attrs,
      onlyCovered: !!raw.onlyCovered,
      showLocked: !!raw.showLocked,
      onlyFav: !!raw.onlyFav,
      savedAt: Number(raw.savedAt) || 0,
    };
  }

  function readLocalFilters() {
    try {
      return normalizeFilters(JSON.parse(localStorage.getItem("witchfire-atelier-filtres") || "null"));
    } catch (err) {
      return null;
    }
  }

  function applyFilters(raw) {
    const filters = normalizeFilters(raw);
    if (!filters) return;
    state.gnosis = filters.gnosis;
    state.mysterium = filters.mysterium;
    state.style = filters.style;
    state.elements = filters.elements.slice();
    state.weapon = filters.weapon;
    state.sort = filters.sort;
    state.scoreCut = filters.scoreCut;
    state.attrs = Object.assign({}, filters.attrs);
    state.onlyCovered = filters.onlyCovered;
    state.showLocked = filters.showLocked;
    state.onlyFav = filters.onlyFav;
  }

  function snapshotFilters() {
    return {
      gnosis: state.gnosis,
      mysterium: state.mysterium,
      style: state.style,
      elements: state.elements.slice(),
      weapon: state.weapon,
      sort: state.sort,
      scoreCut: state.scoreCut,
      attrs: Object.assign({}, state.attrs),
      onlyCovered: state.onlyCovered,
      showLocked: state.showLocked,
      onlyFav: state.onlyFav,
      savedAt: Date.now(),
    };
  }

  function rememberFilters() {
    filterEpoch += 1;
    const filters = snapshotFilters();
    localStorage.setItem("witchfire-atelier-filtres", JSON.stringify(filters));
    state.vault.filters = filters;
    if (!vaultReady) return;
    clearTimeout(filterTimer);
    filterTimer = setTimeout(saveVault, 300);
  }

  function syncFilterControls() {
    if (!$("gnosis")) return;
    $("gnosis").value = String(state.gnosis);
    paintRange($("gnosis"));
    $("mysterium").value = state.mysterium;
    $("style").value = state.style;
    $("sort").value = state.sort;
    $("score-cut").value = state.scoreCut;
    const weapon = $("weapon");
    const known = [...weapon.options].some((option) => option.value === state.weapon);
    weapon.value = known ? state.weapon : "";
    state.weapon = weapon.value;
    $("locked").checked = state.showLocked;
    $("only-fav").checked = state.onlyFav;
    $("only-covered").checked = state.onlyCovered;
    for (const btn of document.querySelectorAll("#elements .chip")) {
      btn.classList.toggle("is-on", state.elements.includes(btn.dataset.element));
    }
    markPhases();
    repaintAttrFilters();
  }

  function loadVault() {
    try {
      return normalizeVault(JSON.parse(localStorage.getItem("witchfire-atelier") || "{}"));
    } catch (err) {
      return emptyVault();
    }
  }

  function vaultHasEntries(vault) {
    return vault.custom.length > 0 || vault.favorites.length > 0;
  }

  function saveVault() {
    const epoch = ++vaultEpoch;
    const payload = JSON.stringify(state.vault);
    localStorage.setItem("witchfire-atelier", payload);
    fetch("/api/sauvegardes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }).then((res) => {
      if (res.ok) state.vaultFile = true;
    }).catch(() => {
      if (epoch !== vaultEpoch) return;
    });
  }

  function pullVault() {
    const epoch = vaultEpoch;
    const filtersAtStart = filterEpoch;
    fetch("/api/sauvegardes", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((raw) => {
        if (epoch !== vaultEpoch) {
          vaultReady = true;
          return;
        }
        if (!raw) {
          vaultReady = true;
          return;
        }
        state.vaultFile = true;
        const file = normalizeVault(raw);
        const localFilters = readLocalFilters();
        const fileFilters = normalizeFilters(file.filters);
        let filters = localFilters;
        if (filtersAtStart === 0 && fileFilters && fileFilters.savedAt > ((localFilters && localFilters.savedAt) || 0)) {
          filters = fileFilters;
          applyFilters(fileFilters);
          localStorage.setItem("witchfire-atelier-filtres", JSON.stringify(fileFilters));
          syncFilterControls();
          run();
        }
        file.filters = filters;
        const fileAt = (fileFilters && fileFilters.savedAt) || 0;
        const chosenAt = (filters && filters.savedAt) || 0;
        if (!vaultHasEntries(file) && vaultHasEntries(state.vault)) {
          state.vault.filters = filters;
          vaultReady = true;
          saveVault();
          return;
        }
        if (!vaultHasEntries(file)) {
          state.vault.filters = filters;
          vaultReady = true;
          if (filters && chosenAt > fileAt) saveVault();
          return;
        }
        state.vault = file;
        localStorage.setItem("witchfire-atelier", JSON.stringify(state.vault));
        vaultReady = true;
        if (filters && chosenAt > fileAt) saveVault();
        if (state.result) renderBuilds();
        if (state.tab === "create") renderAtelier();
      })
      .catch(() => {
        vaultReady = true;
      });
  }

  function savedMessage(lead) {
    if (state.vaultFile) return `${lead} Il reste dans Mes équipements, et dans le fichier atelier-sauvegardes.json à côté du programme.`;
    return `${lead} Il reste dans Mes équipements, dans ce navigateur.`;
  }

  function defaultAttrs() {
    const attrs = {};
    for (const attr of WF.attributes) attrs[attr.id] = 40;
    return attrs;
  }

  function blankDraft() {
    const slots = {};
    for (const key of SLOTS) slots[key] = key === "melee" ? "fist" : "";
    return {
      id: "",
      name: "Mon équipement",
      gnosis: state.gnosis,
      mysterium: "3",
      slots,
      beads: [],
      ownBeads: false,
      attrs: defaultAttrs(),
      critRate: 0,
      gun: "primary",
      blurb: "",
      sourceId: "",
    };
  }

  function draftFromEntry(entry) {
    const slots = {};
    for (const key of SLOTS) slots[key] = (entry.slots && entry.slots[key]) || (key === "melee" ? "fist" : "");
    return {
      id: entry.id || "",
      name: entry.name || "Mon équipement",
      gnosis: entry.gnosis != null ? entry.gnosis : state.gnosis,
      mysterium: entry.mysterium != null ? String(entry.mysterium) : "3",
      slots,
      beads: Array.isArray(entry.beads) ? entry.beads.slice() : [],
      ownBeads: entry.ownBeads != null ? !!entry.ownBeads : true,
      attrs: Object.assign(defaultAttrs(), entry.attrs || {}),
      critRate: entry.critRate || 0,
      gun: entry.gun || "primary",
      blurb: entry.blurb || "",
      sourceId: entry.sourceId || "",
    };
  }

  function findSaved(build) {
    if (!build) return null;
    if (build.custom) return state.vault.custom.find((item) => item.id === build.id) || null;
    const source = build.sourceId || build.id;
    return state.vault.custom.find((item) => item.sourceId === source) || null;
  }

  function isFav(build) {
    return state.vault.favorites.some((entry) => entry.id === build.id);
  }

  function snapshot(build) {
    const slots = {};
    for (const key of SLOTS) slots[key] = build.loadout[key] ? build.loadout[key].id : "";
    const sim = state.sims[build.id];
    return {
      id: build.id,
      name: build.name,
      slots,
      beads: (build.beads || []).map((bead) => bead.id),
      gnosis: build.gnosis,
      mysterium: String(build.mysterium),
      attrs: (sim && sim.attrs) || build.attrs || null,
      critRate: sim ? sim.critRate : (build.critRate || 0),
      gun: (sim && sim.gun) || build.gun || "primary",
      custom: !!build.custom,
      ownBeads: true,
      blurb: build.blurb || "",
      sourceId: build.sourceId || "",
    };
  }

  function toggleFav(build) {
    if (isFav(build)) state.vault.favorites = state.vault.favorites.filter((entry) => entry.id !== build.id);
    else state.vault.favorites.push(snapshot(build));
    saveVault();
  }

  function starButton(build) {
    const star = document.createElement("button");
    star.type = "button";
    star.className = "star";
    star.textContent = isFav(build) ? "★" : "☆";
    star.setAttribute("aria-label", isFav(build) ? "Retirer des favoris" : "Mettre en favori");
    star.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFav(build);
      renderBuilds();
      const fav = document.querySelector("#detail .fav-label");
      if (fav && state.open === build.id) fav.textContent = isFav(build) ? "Retirer des favoris" : "Mettre en favori";
    });
    return star;
  }

  function sectionTitle(text) {
    const h = document.createElement("h2");
    h.className = "section-title";
    h.textContent = text;
    return h;
  }

  function customCards() {
    return state.vault.custom.map((entry) => WF.present(Object.assign({}, entry, { custom: true }))).filter(Boolean);
  }

  function simModel(build) {
    if (!state.sims[build.id]) {
      state.sims[build.id] = {
        attrs: Object.assign(defaultAttrs(), build.attrs || {}),
        critRate: build.critRate || 0,
        gun: build.gun || "primary",
      };
    }
    return state.sims[build.id];
  }

  function markTab(name) {
    for (const tab of document.querySelectorAll(".tab")) {
      const on = tab.dataset.tab === name;
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-selected", String(on));
    }
  }

  function showCreate() {
    state.tab = "create";
    markTab("create");
    $("view-builds").hidden = true;
    $("view-create").hidden = false;
    $("view-lab").hidden = true;
    $("view-codex").hidden = true;
    $("view-rules").hidden = true;
    $("view-guide").hidden = true;
    renderAtelier();
  }

  function openInAtelier(build) {
    const saved = findSaved(build);
    if (saved) state.draft = draftFromEntry(saved);
    else {
      const shot = snapshot(build);
      state.draft = draftFromEntry({
        id: build.custom ? build.id : "",
        name: build.name,
        gnosis: shot.gnosis,
        mysterium: shot.mysterium,
        slots: shot.slots,
        beads: shot.beads,
        ownBeads: true,
        attrs: shot.attrs,
        critRate: shot.critRate,
        gun: shot.gun,
        blurb: build.blurb || "",
        sourceId: build.custom ? (build.sourceId || "") : build.id,
      });
    }
    state.draftNotice = "";
    showCreate();
  }

  function entryFromDraft(draft) {
    return {
      id: draft.id,
      name: draft.name || "Mon équipement",
      gnosis: draft.gnosis,
      mysterium: draft.mysterium,
      slots: draft.slots,
      beads: draft.ownBeads ? draft.beads : [],
      ownBeads: !!draft.ownBeads,
      attrs: draft.attrs,
      critRate: draft.critRate || 0,
      gun: draft.gun || "primary",
      custom: true,
      sourceId: draft.sourceId || "",
      blurb: draft.blurb || "Équipement enregistré dans l'atelier, avec sa transcendance.",
    };
  }

  function upsertCustom(entry) {
    const index = state.vault.custom.findIndex((item) => item.id === entry.id);
    if (index >= 0) state.vault.custom[index] = entry;
    else state.vault.custom.unshift(entry);
    saveVault();
  }

  function saveBuild(build) {
    const existing = findSaved(build);
    if (existing && !build.custom) return existing;
    const shot = snapshot(build);
    const id = existing ? existing.id : (build.custom ? build.id : `perso-${Date.now()}`);
    const entry = {
      id,
      name: shot.name || "Mon équipement",
      gnosis: shot.gnosis,
      mysterium: shot.mysterium,
      slots: shot.slots,
      beads: shot.beads,
      ownBeads: true,
      attrs: shot.attrs,
      critRate: shot.critRate,
      gun: shot.gun,
      custom: true,
      sourceId: build.custom ? (build.sourceId || "") : build.id,
      blurb: shot.blurb || (build.custom ? "Équipement enregistré dans l'atelier, avec sa transcendance." : `Copie de « ${build.name} ».`),
    };
    upsertCustom(entry);
    return entry;
  }

  function deleteCustom(id) {
    state.vault.custom = state.vault.custom.filter((entry) => entry.id !== id);
    state.vault.favorites = state.vault.favorites.filter((entry) => entry.id !== id);
    delete state.sims[id];
    saveVault();
    if (state.draft && state.draft.id === id) state.draft = blankDraft();
    if (state.open === id) closeDetail();
    state.flash = null;
    if (state.result) renderBuilds();
    if (state.tab === "create") renderAtelier();
  }

  function draftCard() {
    const draft = state.draft;
    return WF.present({
      id: draft.id || "brouillon",
      name: draft.name || "Mon équipement",
      gnosis: draft.gnosis,
      mysterium: draft.mysterium,
      slots: draft.slots,
      beads: draft.ownBeads ? draft.beads : [],
      ownBeads: !!draft.ownBeads,
      attrs: draft.attrs,
      custom: true,
      sourceId: draft.sourceId || "",
      critRate: draft.critRate || 0,
      gun: draft.gun || "primary",
      blurb: draft.blurb || "Brouillon de l'atelier. L'enregistrement le place dans Mes équipements.",
    });
  }

  function setupAtelier() {
    state.draft = blankDraft();
  }

  function renderAtelier() {
    if (!state.draft) state.draft = blankDraft();
    const form = $("create-form");
    const out = $("create-out");
    form.innerHTML = "";
    const h = document.createElement("h2");
    h.textContent = "Composer un équipement";
    form.appendChild(h);
    const savedTitle = document.createElement("h3");
    savedTitle.textContent = "Équipements enregistrés";
    form.appendChild(savedTitle);
    form.appendChild(savedPicker());
    const grid = document.createElement("div");
    grid.className = "form-grid";
    const name = document.createElement("label");
    name.append("Nom");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = state.draft.name;
    nameInput.addEventListener("input", () => {
      state.draft.name = nameInput.value;
      paintAtelierOutput();
    });
    name.appendChild(nameInput);
    grid.appendChild(name);
    const note = document.createElement("label");
    note.append("Note");
    const noteInput = document.createElement("textarea");
    noteInput.value = state.draft.blurb || "";
    noteInput.addEventListener("input", () => {
      state.draft.blurb = noteInput.value;
    });
    note.appendChild(noteInput);
    grid.appendChild(note);
    grid.appendChild(numberField("Gnosis", state.draft.gnosis, 0, 7, (value) => {
      state.draft.gnosis = value;
      renderAtelier();
    }));
    const myst = document.createElement("label");
    myst.append("Mysterium");
    const mystSelect = document.createElement("select");
    for (const [value, label] of [["auto", "Automatique"], ["1", "Mysterium I"], ["2", "Mysterium II"], ["3", "Mysterium III"]]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      mystSelect.appendChild(opt);
    }
    mystSelect.value = state.draft.mysterium;
    mystSelect.addEventListener("change", () => {
      state.draft.mysterium = mystSelect.value;
      paintAtelierOutput();
    });
    myst.appendChild(mystSelect);
    grid.appendChild(myst);
    const lists = {
      primary: WF.catalog().weapons,
      secondary: WF.catalog().weapons,
      demonic: WF.catalog().demonic,
      melee: WF.catalog().melee,
      light: WF.catalog().spells.filter((entry) => entry.spellType === "light"),
      heavy: WF.catalog().spells.filter((entry) => entry.spellType === "heavy"),
      relic: WF.catalog().relics,
      ring: WF.catalog().rings,
      fetish: WF.catalog().fetishes,
    };
    for (const key of SLOTS) {
      const label = document.createElement("label");
      label.className = "slot-field";
      const head = document.createElement("span");
      head.className = "slot-field-head";
      const frame = document.createElement("span");
      frame.className = "slot-frame";
      frame.appendChild(portrait(WF.item(state.draft.slots[key])));
      const title = document.createElement("span");
      title.textContent = SLOT_LABELS[key];
      head.append(frame, title);
      const select = document.createElement("select");
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "Vide";
      select.appendChild(empty);
      for (const entry of lists[key]) {
        const opt = document.createElement("option");
        opt.value = entry.id;
        opt.textContent = `${entry.name} · Gnosis ${entry.gnosis}`;
        select.appendChild(opt);
      }
      select.value = state.draft.slots[key] || "";
      select.addEventListener("change", () => {
        state.draft.slots[key] = select.value;
        frame.replaceChildren(portrait(WF.item(select.value)));
        paintAtelierOutput();
      });
      label.append(head, select);
      grid.appendChild(label);
    }
    form.appendChild(grid);

    const hAttr = document.createElement("h3");
    hAttr.textContent = "Transcendance";
    form.appendChild(hAttr);
    const presets = document.createElement("div");
    presets.className = "presets";
    const presetRows = [
      ["Début", { flesh: 15, blood: 15, mind: 15, witchery: 15, arsenal: 15, faith: 15 }],
      ["Équilibré", defaultAttrs()],
      ["Survie", { flesh: 80, blood: 80, mind: 25, witchery: 25, arsenal: 30, faith: 25 }],
      ["Sorcellerie", { flesh: 20, blood: 20, mind: 40, witchery: 90, arsenal: 20, faith: 40 }],
      ["Arsenal", { flesh: 20, blood: 40, mind: 25, witchery: 20, arsenal: 90, faith: 40 }],
    ];
    for (const [label, attrs] of presetRows) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        state.draft.attrs = Object.assign(defaultAttrs(), attrs);
        renderAtelier();
      });
      presets.appendChild(btn);
    }
    form.appendChild(presets);
    form.appendChild(attrFields(state.draft.attrs, () => paintAtelierOutput()));

    const own = document.createElement("label");
    own.className = "checkline";
    const ownBox = document.createElement("input");
    ownBox.type = "checkbox";
    ownBox.checked = state.draft.ownBeads;
    ownBox.addEventListener("change", () => {
      state.draft.ownBeads = ownBox.checked;
      renderAtelier();
    });
    own.append(ownBox, document.createTextNode(" Choisir les perles moi-même"));
    form.appendChild(own);
    if (state.draft.ownBeads) {
      const picks = document.createElement("div");
      picks.className = "bead-picks";
      const cap = WF.rosarySlots(state.draft.gnosis);
      for (const bead of WF.catalog().beads.filter((entry) => entry.gnosis <= state.draft.gnosis)) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip bead-pick" + (state.draft.beads.includes(bead.id) ? " is-on" : "");
        chip.appendChild(portrait(bead));
        const chipName = document.createElement("span");
        chipName.textContent = bead.name.replace(" Bead", "");
        chip.appendChild(chipName);
        const asked = gateText(gatesOf(bead));
        if (asked) {
          const req = document.createElement("small");
          req.textContent = asked;
          chip.appendChild(req);
        }
        chip.addEventListener("click", () => {
          if (state.draft.beads.includes(bead.id)) state.draft.beads = state.draft.beads.filter((id) => id !== bead.id);
          else if (state.draft.beads.length < cap) state.draft.beads.push(bead.id);
          renderAtelier();
        });
        picks.appendChild(chip);
      }
      form.appendChild(picks);
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = `${state.draft.beads.length} / ${cap} perles. Sans cette case, le moteur remplit le rosaire.`;
      form.appendChild(hint);
    }

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary";
    save.textContent = state.draft.id ? "Mettre à jour" : "Enregistrer";
    save.addEventListener("click", saveDraft);
    const fresh = document.createElement("button");
    fresh.type = "button";
    fresh.textContent = "Nouveau";
    fresh.addEventListener("click", () => {
      state.draft = blankDraft();
      state.draftNotice = "";
      renderAtelier();
    });
    actions.append(save, fresh);
    if (state.draft.id) {
      const drop = document.createElement("button");
      drop.type = "button";
      drop.textContent = "Supprimer";
      drop.addEventListener("click", () => {
        if (!window.confirm("Supprimer cet équipement enregistré ?")) return;
        deleteCustom(state.draft.id);
      });
      actions.appendChild(drop);
    }
    form.appendChild(actions);
    if (state.draftNotice) {
      const notice = document.createElement("p");
      notice.className = "notice";
      notice.textContent = state.draftNotice;
      form.appendChild(notice);
    }
    paintAtelierOutput();
    out.scrollTop = out.scrollTop;
  }

  function paintAtelierOutput() {
    const out = $("create-out");
    out.innerHTML = "";
    const h = document.createElement("h2");
    h.textContent = "Simulateur";
    out.appendChild(h);
    const card = draftCard();
    const gear = document.createElement("div");
    gear.className = "gear sim-gear";
    for (const [label, key] of [["Arme", "primary"], ["Secondaire", "secondary"], ["Démoniaque", "demonic"], ["Mêlée", "melee"], ["Léger", "light"], ["Lourd", "heavy"], ["Relique", "relic"], ["Anneau", "ring"], ["Fétiche", "fetish"]]) {
      gear.appendChild(gearCell(label, card.loadout[key]));
    }
    out.appendChild(gear);
    if (card.beads.length) {
      out.appendChild(beadRow(card.beads, true));
      const gate = gateNote(card.beads, state.draft.attrs);
      if (gate) out.appendChild(gate);
    }
    out.appendChild(simPanel({
      loadout: card.loadout,
      beads: card.beads,
      mysterium: card.mysterium,
      attrs: state.draft.attrs,
      critRate: state.draft.critRate,
      gun: state.draft.gun,
      onGun: (value) => { state.draft.gun = value; },
      onCrit: (value) => { state.draft.critRate = value; },
    }, false));
  }

  function savedPicker() {
    if (!state.vault.custom.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Rien d'enregistré pour l'instant. Compose un équipement, ou ouvre un build et choisis Enregistrer une copie.";
      return empty;
    }
    const box = document.createElement("div");
    box.className = "saved-list";
    for (const entry of state.vault.custom) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = entry.name || "Sans nom";
      if (state.draft.id === entry.id) btn.classList.add("is-on");
      btn.addEventListener("click", () => {
        state.draft = draftFromEntry(entry);
        state.draftNotice = "";
        renderAtelier();
      });
      box.appendChild(btn);
    }
    return box;
  }

  function saveDraft() {
    const draft = state.draft;
    if (!draft.id) draft.id = `perso-${Date.now()}`;
    upsertCustom(entryFromDraft(draft));
    state.draftNotice = savedMessage("Enregistré.");
    renderAtelier();
    if (state.result) renderBuilds();
  }

  function numberField(label, value, min, max, onChange) {
    const wrap = document.createElement("label");
    const title = document.createElement("span");
    title.className = "inline-num";
    const name = document.createElement("span");
    name.textContent = label;
    const num = document.createElement("strong");
    num.textContent = String(value);
    title.append(name, num);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener("input", () => {
      num.textContent = input.value;
      onChange(Number(input.value));
    });
    wireRange(input);
    wrap.append(title, input);
    return wrap;
  }

  function attrFields(attrs, onChange) {
    const box = document.createElement("div");
    box.className = "form-grid";
    for (const attr of WF.attributes) {
      box.appendChild(numberField(attr.name, attrs[attr.id] || 0, 0, 100, (value) => {
        attrs[attr.id] = value;
        onChange();
      }));
    }
    return box;
  }

  function simPanel(model, editAttrs) {
    const wrap = document.createElement("div");
    wrap.className = "sim";
    const controls = document.createElement("div");
    controls.className = "sim-controls form-grid";
    const loadout = model.loadout || {};
    const guns = [["primary", "Arme principale"], ["secondary", "Arme secondaire"], ["demonic", "Arme démoniaque"], ["melee", "Mêlée"]]
      .filter(([key]) => loadout[key] && loadout[key].stats);
    if (guns.length) {
      const label = document.createElement("label");
      label.append("Arme simulée");
      const select = document.createElement("select");
      for (const [key, text] of guns) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = `${text} — ${loadout[key].name}`;
        select.appendChild(opt);
      }
      if (!guns.some(([key]) => key === model.gun)) model.gun = guns[0][0];
      select.value = model.gun;
      select.addEventListener("change", () => {
        model.gun = select.value;
        if (model.onGun) model.onGun(select.value);
        draw();
      });
      label.appendChild(select);
      controls.appendChild(label);
    }
    controls.appendChild(numberField("Part de tirs critiques", Math.round((model.critRate || 0) * 100), 0, 100, (value) => {
      model.critRate = value / 100;
      if (model.onCrit) model.onCrit(model.critRate);
      draw();
    }));
    wrap.appendChild(controls);
    const output = document.createElement("div");
    wrap.appendChild(output);
    const draw = () => {
      output.innerHTML = "";
      const result = WF.simulate(loadout, model.beads || [], model.mysterium, model.attrs || {}, {
        gun: model.gun,
        critRate: model.critRate,
      });
      const stats = document.createElement("div");
      stats.className = "stat-grid";
      for (const row of result.stats) {
        const line = document.createElement("div");
        const name = document.createElement("span");
        name.textContent = row.name;
        const value = document.createElement("b");
        value.textContent = row.text;
        line.append(name, value);
        stats.appendChild(line);
      }
      output.appendChild(stats);
      if (!result.gun) {
        const empty = document.createElement("p");
        empty.textContent = "Choisis une arme pour simuler le tir.";
        output.appendChild(empty);
      } else {
        const sheet = document.createElement("p");
        sheet.textContent = result.melee
          ? `${result.gun.name} : simple ${result.gun.stats.damage}, chargé ${result.gun.stats.charged}, spécial ${result.gun.stats.special}. Allonge du chargé : ${result.gun.stats.reach || 0} m.`
          : `${result.gun.name} : ${WF.fmt(result.sheet.damage, 0)} dégâts, critique ×${WF.fmt(result.sheet.crit, 2)}, ${WF.fmt(result.sheet.ads, 0)} m en visée après portée, réserve ${WF.fmt(result.sheet.reserve, 0)}.`;
        output.appendChild(sheet);
        const table = document.createElement("table");
        table.className = "sim-table";
        const head = document.createElement("tr");
        for (const label of ["Situation", "Tir", "Critique", "Moyenne", "Par seconde"]) {
          const th = document.createElement("th");
          th.textContent = label;
          head.appendChild(th);
        }
        table.appendChild(head);
        for (const row of result.rows) {
          const tr = document.createElement("tr");
          for (const value of [row.name, WF.fmt(row.hit), row.crit == null ? "—" : WF.fmt(row.crit), row.avg == null ? "—" : WF.fmt(row.avg), row.dps == null ? "—" : WF.fmt(row.dps)]) {
            const td = document.createElement("td");
            td.textContent = value;
            tr.appendChild(td);
          }
          table.appendChild(tr);
        }
        const tableWrap = document.createElement("div");
        tableWrap.className = "table-wrap";
        tableWrap.appendChild(table);
        output.appendChild(tableWrap);
        if (result.math.comboTick || result.math.tickShock || result.math.package) {
          const combo = document.createElement("p");
          const parts = [];
          if (result.math.comboTick) parts.push(`tick ${WF.fmt(result.math.comboTick)}`);
          if (result.math.comboTotal) parts.push(`total de la table ${WF.fmt(result.math.comboTotal)}`);
          if (result.math.tickShock) parts.push(`éclair du tick ${WF.fmt(result.math.tickShock)}, second saut ${WF.fmt(result.math.tickShockSecond)}`);
          if (result.math.package) parts.push(`combo retenu ${WF.fmt(result.math.package)}`);
          combo.textContent = `Combo élémentaire, sans remultiplier la durée : ${parts.join(", ")}.`;
          output.appendChild(combo);
        }
      }
      const notes = document.createElement("ul");
      notes.className = "note-list";
      for (const text of result.notes) {
        const li = document.createElement("li");
        li.textContent = text;
        notes.appendChild(li);
      }
      const stack = document.createElement("li");
      stack.textContent = "Le gel ajoute 50 % au tir. L'étourdissement dur le double. Les deux se multiplient. La brûlure utilise le multiplicateur du wiki. Brûlure + Choc : tir × choc × 2,1 × brûlure, second saut à moitié. Un tick de putréfaction sur un gelé prend aussi ×1,5, sans rallonger le nombre de ticks. Si la brûlure est déjà là, ce ×1,5 est celui de Brûlure + Putréfaction et le gel n'est pas empilé une seconde fois. Chaque tick renvoie un éclair égal à sa puissance × la magnitude de choc. L'explosion Brûlure + Gel n'a pas de montant publié.";
      notes.appendChild(stack);
      output.appendChild(notes);
    };
    if (editAttrs) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Transcendance de cette lecture";
      details.appendChild(summary);
      details.appendChild(attrFields(model.attrs, draw));
      wrap.insertBefore(details, output);
    }
    draw();
    return wrap;
  }

  function markPhases() {
    const phase = WF.phaseOf(state.gnosis).id;
    for (const btn of document.querySelectorAll(".phase")) {
      const target = phases.find((p) => String(p.gnosis) === btn.dataset.gnosis);
      btn.classList.toggle("is-on", !!(target && target.id === phase));
    }
  }

  function setupTabs() {
    for (const tab of document.querySelectorAll(".tab")) {
      tab.addEventListener("click", () => {
        state.tab = tab.dataset.tab;
        markTab(state.tab);
        $("view-builds").hidden = state.tab !== "builds";
        $("view-create").hidden = state.tab !== "create";
        $("view-lab").hidden = state.tab !== "lab";
        $("view-codex").hidden = state.tab !== "codex";
        $("view-rules").hidden = state.tab !== "rules";
        $("view-guide").hidden = state.tab !== "guide";
        if (state.tab === "rules") renderRules();
        if (state.tab === "codex") renderCodex("weapons");
        if (state.tab === "create") renderAtelier();
        if (state.tab === "guide") renderGuide();
      });
    }
  }

  function setupLab() {
    const decaySources = sourcesOf("decay");
    const burnSources = sourcesOf("burn");
    const shockSources = sourcesOf("shock");
    fillSelect($("lab-decay"), decaySources);
    fillSelect($("lab-burn"), burnSources);
    fillSelect($("lab-shock"), shockSources);
    const draw = () => {
      const shot = Number($("lab-shot").value) || 40;
      const math = WF.explainLab($("lab-decay").value, $("lab-burn").value, $("lab-beads").value, shot, $("lab-shock").value);
      const out = $("lab-out");
      out.innerHTML = "";
      if (math.comboTotal || math.shockChain || math.shockShot || math.shockFirst || math.tickShock || math.takenBurn || math.takenFreeze) {
        const result = document.createElement("div");
        result.className = "lab-result";
        if (math.takenBurn) result.appendChild(labFigure(WF.fmt(math.takenBurn), "Tir sous brûlure"));
        if (math.takenFreeze) result.appendChild(labFigure(WF.fmt(math.takenFreeze), "Tir sur gelé"));
        if (math.takenBurnFreeze) result.appendChild(labFigure(WF.fmt(math.takenBurnFreeze), "Tir, brûlure et gel"));
        if (math.comboTick) result.appendChild(labFigure(WF.fmt(math.comboTick), "Tick de putréfaction"));
        if (math.comboTotal) result.appendChild(labFigure(WF.fmt(math.comboTotal), "Total de la table"));
        if (math.shockFirst) result.appendChild(labFigure(WF.fmt(math.shockFirst), "Choc, premier rebond"));
        if (math.shockFirst) result.appendChild(labFigure(WF.fmt(math.shockSecond), "Choc, second rebond"));
        if (math.shockChain) result.appendChild(labFigure(WF.fmt(math.shockChain), "Brûlure + choc, premier rebond"));
        if (math.shockChain) result.appendChild(labFigure(WF.fmt(math.shockSecond), "Brûlure + choc, second rebond"));
        if (math.shockShot) result.appendChild(labFigure(WF.fmt(math.shockShot), "Tir avec brûlure et choc"));
        if (math.tickShock) result.appendChild(labFigure(WF.fmt(math.tickShock), "Éclair du tick"));
        if (math.tickShockSecond) result.appendChild(labFigure(WF.fmt(math.tickShockSecond), "Éclair secondaire du tick"));
        if (math.package) result.appendChild(labFigure(WF.fmt(math.package), "Combo retenu"));
        out.appendChild(result);
      } else {
        const h = document.createElement("h2");
        h.textContent = "Lecture des deux malus";
        out.appendChild(h);
      }
      for (const step of math.lines) {
        const block = document.createElement("p");
        block.className = "proof-step";
        const strong = document.createElement("strong");
        strong.textContent = step.title;
        block.appendChild(strong);
        block.append(" " + step.text);
        out.appendChild(block);
      }
    };
    $("lab-run").addEventListener("click", draw);
    $("lab-shot").addEventListener("change", draw);
    draw();
  }

  function labFigure(value, label) {
    const box = document.createElement("div");
    box.className = "lab-figure";
    const number = document.createElement("b");
    number.textContent = value;
    const caption = document.createElement("span");
    caption.textContent = label;
    box.append(number, caption);
    return box;
  }

  function sourcesOf(kind) {
    const all = WF.catalog().weapons.concat(WF.catalog().spells, WF.catalog().relics, WF.catalog().rings);
    return all.filter((entry) => entry.applies && entry.applies[kind]);
  }

  function fillSelect(select, entries) {
    for (const entry of entries) {
      const opt = document.createElement("option");
      opt.value = entry.id;
      opt.textContent = `${entry.name} · Gnosis ${entry.gnosis}`;
      select.appendChild(opt);
    }
  }

  function mysteriumParts(lines) {
    const buckets = { M1: [], M2: [], M3: [] };
    const extra = [];
    const mark = /M([123])\s*:/g;
    for (const line of lines || []) {
      const hits = [...line.matchAll(mark)];
      if (!hits.length) {
        extra.push(line);
        continue;
      }
      if (hits[0].index > 0) {
        const lead = line.slice(0, hits[0].index).trim();
        if (lead) extra.push(lead);
      }
      for (let i = 0; i < hits.length; i++) {
        const start = hits[i].index + hits[i][0].length;
        const end = i + 1 < hits.length ? hits[i + 1].index : line.length;
        const text = line.slice(start, end).trim();
        if (text) buckets["M" + hits[i][1]].push(text);
      }
    }
    return { buckets, extra };
  }

  function appendMysteria(card, entry) {
    const { buckets, extra } = mysteriumParts(entry.mysteria);
    const hasLevel = ["M1", "M2", "M3"].some((key) => buckets[key].length);
    if (hasLevel) {
      const dl = document.createElement("dl");
      dl.className = "mysteria";
      for (const key of ["M1", "M2", "M3"]) {
        const row = document.createElement("div");
        row.className = "myst-row";
        const dt = document.createElement("dt");
        dt.textContent = { M1: "I", M2: "II", M3: "III" }[key];
        const dd = document.createElement("dd");
        dd.textContent = buckets[key].join(" ") || "Le wiki ne détaille pas ce palier.";
        row.append(dt, dd);
        dl.appendChild(row);
      }
      card.appendChild(dl);
    }
    for (const line of extra) {
      const li = document.createElement("p");
      li.className = "sub";
      li.textContent = line;
      card.appendChild(li);
    }
  }

  function renderCodex(which) {
    const nav = $("codex-nav");
    nav.innerHTML = "";
    const groups = [
      ["weapons", "Armes"],
      ["demonic", "Armes démoniaques"],
      ["melee", "Mêlée"],
      ["spells", "Sorts"],
      ["relics", "Reliques"],
      ["rings", "Anneaux"],
      ["fetishes", "Fétiches"],
      ["beads", "Perles"],
    ];
    for (const [id, label] of groups) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (id === which ? " is-on" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => renderCodex(id));
      nav.appendChild(btn);
    }
    const list = $("codex-list");
    list.innerHTML = "";
    for (const entry of WF.catalog()[which]) {
      const card = document.createElement("article");
      card.className = "codex-card";
      if (entry.elements && entry.elements[0]) card.dataset.accent = entry.elements[0];
      const head = document.createElement("div");
      head.className = "codex-head";
      head.appendChild(portrait(entry));
      const title = document.createElement("div");
      title.className = "codex-title";
      const h = document.createElement("h2");
      h.textContent = entry.name;
      title.appendChild(h);
      const marks = elementMarks(entry.elements);
      if (marks) {
        const named = document.createElement("div");
        named.className = "meta";
        for (const id of entry.elements) named.appendChild(badge(window.WF_DATA.EL[id].name, id));
        title.appendChild(named);
      }
      head.appendChild(title);
      const p = document.createElement("p");
      p.className = "codex-meta";
      p.textContent = [`Gnosis ${entry.gnosis}`, WF.statsLine(entry), entry.found || ""].filter(Boolean).join(" · ");
      card.append(head, p);
      appendMysteria(card, entry);
      if (entry.url) {
        const a = document.createElement("a");
        a.href = entry.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = "Page du wiki";
        card.appendChild(a);
      }
      list.appendChild(card);
    }
  }

  function renderRules() {
    const root = $("view-rules");
    if (root.childElementCount) return;
    root.className = "rules panel";
    root.innerHTML = "";
    const h = document.createElement("h2");
    h.textContent = "Ce que le moteur décide, et ce qu'il refuse d'inventer";
    root.appendChild(h);
    const items = [
      "Un équipement compte deux armes standard, une démoniaque, une mêlée, un sort léger, un sort lourd, une relique, un fétiche et un anneau. Le rosaire a 1 perle au Gnosis 0, puis 2, 3, 4, 4 et 5 à partir du Gnosis V.",
      "Le Mysterium automatique est I au début (Gnosis 0-I), II au milieu (II-III) et III en fin de partie. Le menu peut forcer un palier.",
      "L'élément d'une fiche ouvre la pioche d'arcanes. Il n'applique un malus que si la page du wiki le dit. Hangfire est Feu sans être une source de Brûlure dans les tables.",
      "Brûlure + Putréfaction : tick × multiplicateur de brûlure × 1,5. Le multiplicateur de base +25 % vaut 1,25. L'exemple du wiki : 15 × 1,25 × 1,5 = 28,125.",
      "Ailment Power vaut ×1,25, Acute Ailment ×2, les deux ×2,25. Les bonus partent de la valeur de base et s'additionnent. Basilisk, la marque de Nemesis, Parasite, Book of Serpents et Kirfane ignorent ces perles, entièrement ou en partie.",
      "Un ennemi gelé subit +50 % de dégâts. Ce bonus ignore les perles. Acute raccourcit le gel.",
      "Brûlure + Gel : le tir garanti vaut dégâts × multiplicateur de brûlure × 1,5. L'explosion du couple n'a pas de montant publié. Putréfaction + Gel, sans brûlure : le tick et le total de la table prennent ×1,5. Le wiki dit aussi que ça dure plus longtemps, sans dire de combien : aucun tick n'est ajouté. Putréfaction + Choc : chaque tick renvoie un éclair égal à sa puissance × la magnitude de choc, le second saut à moitié. Gel + Choc accélère les éclairs, et cette fréquence n'est pas dans les tables.",
      "Brûlure + Choc, si le groupe brûle : tir × magnitude d'éclair × 2,1 × multiplicateur de brûlure. Le tir lui-même augmente de dégâts × magnitude de base × facteur de perles × 2,3. La table du wiki ne publie le multiplicateur combiné que pour 30 %, 37,5 % et 60 % de chaîne, avec une brûlure de 25 % ou 37,5 %.",
      "Les totaux de ticks de la page Éléments ont été mesurés avec +50 % de durée. Le moteur n'applique pas une seconde fois la perle Elemental Duration.",
      "Deux objets du même élément ne rendent pas cet arcane plus probable. Un seul représentant suffit.",
      "Le score pondère le total publié par la facilité à maintenir la source. Une rafale de Rotweaver compte pour sa pleine valeur. Un encensoir ou un familier compte moins, tout en gardant leur total de table dans la preuve.",
      "Les builds cités viennent de r/Witchfire, des vidéos et des fiches wiki. S'il manque une pièce, le moteur la remplace par la meilleure pièce déjà débloquée du même rôle et l'écrit dans la preuve. La transcendance du filtre retire les perles dont le seuil n'est pas atteint.",
      "Une pièce sans malus chiffré sort du classement élémentaire même si elle gagne le combat : Oracle, Psychopomp, Cricket, Angelus, Frostbite, Falling Star, Shockwave, Cursed Bell, Cornucopia, Ring of Wings, Hangfire. Quand un build cité les emporte, il apparaît dans le style Notable. Martyr n'a pas d'élément publié : il n'entre pas dans ce classement.",
    ];
    const ol = document.createElement("ol");
    ol.className = "rules-list";
    for (const text of items) {
      const li = document.createElement("li");
      li.textContent = text;
      ol.appendChild(li);
    }
    root.appendChild(ol);
  }

  function guideBlock(title, lines) {
    const block = document.createElement("section");
    block.className = "guide-section";
    const h = document.createElement("h3");
    h.textContent = title;
    block.appendChild(h);
    for (const line of lines) {
      const p = document.createElement("p");
      if (line.strong) {
        const marks = elementMarks(line.elements);
        if (marks) p.appendChild(marks);
        const b = document.createElement("strong");
        b.textContent = line.strong;
        p.appendChild(b);
        p.appendChild(document.createTextNode(line.text));
      } else {
        p.textContent = line;
      }
      block.appendChild(p);
    }
    return block;
  }

  function elementChart() {
    const fig = document.createElement("figure");
    fig.className = "element-chart";
    const img = document.createElement("img");
    img.src = "images/element-interactions.png";
    img.alt = "Schéma du wiki : Feu, Eau, Air, Terre, et l'effet de chaque couple.";
    fig.appendChild(img);
    return fig;
  }

  function renderGuide() {
    const root = $("view-guide");
    if (root.childElementCount) return;
    root.className = "guide panel";
    root.replaceChildren();

    const title = document.createElement("h2");
    title.textContent = "Dégâts et éléments";
    root.appendChild(title);

    const intro = document.createElement("p");
    intro.className = "guide-intro";
    intro.textContent = "Les chiffres d'arme sont ceux du wiki. Un malus ne s'applique que si la fiche le dit : porter l'élément ouvre la pioche d'arcanes, il ne pose pas le malus à lui seul.";
    root.appendChild(intro);

    root.appendChild(guideBlock("Le tir", [
      "Le dégât affiché est celui d'un tir, ou d'un plomb quand la fiche le précise. Le critique le multiplie par le coefficient de l'arme, entre ×1,1 et ×1,5 selon les pièces.",
      "La portée, l'étourdissement et le coût d'endurance changent comment on pose le tir. Ils ne changent pas la formule du malus.",
      "Un ennemi étourdi prend parfois un bonus propre à l'arme (Striga, mêlée). Ce bonus n'est pas un malus élémentaire.",
    ]));

    root.appendChild(guideBlock("Les quatre malus", [
      { elements: ["fire"], strong: "Feu, Brûlure. ", text: "La cible subit davantage de dégâts. Une brûlure de base +25 % vaut un multiplicateur de 1,25 : dégâts du tir × magnitude. Ce n'est pas un dégât par tick." },
      { elements: ["earth"], strong: "Terre, Putréfaction. ", text: "Des ticks dans la durée. Chaque source a sa ligne du wiki : dégâts par tick, nombre de ticks, total. Deux putréfactions ne s'additionnent pas : le calcul retient la plus forte." },
      { elements: ["air"], strong: "Air, Choc. ", text: "Un éclair saute. Le premier saut vaut un pourcentage du tir, le second la moitié. Sur un tir de 40 et une chaîne de 30 %, cela fait 12 puis 6, avant perles." },
      { elements: ["water"], strong: "Eau, Gel. ", text: "La cible est immobilisée et subit +50 % de dégâts. Ce bonus ignore les perles. La perle Acute raccourcit le gel, elle ne le rend pas plus fort." },
    ]));

    root.appendChild(elementChart());

    root.appendChild(guideBlock("Quand deux malus se rencontrent", [
      { elements: ["fire", "earth"], strong: "Brûlure + Putréfaction. ", text: "tick × multiplicateur de brûlure × 1,5. L'exemple du wiki : 15 × 1,25 × 1,5 = 28,125. Le même facteur s'applique au total de la table." },
      { elements: ["fire", "air"], strong: "Brûlure + Choc. ", text: "Si le groupe brûle : tir × magnitude d'éclair × 2,1 × multiplicateur de brûlure. Le tir lui-même augmente : dégâts + (dégâts × magnitude de brûlure × facteur de perles × 2,3)." },
      { elements: ["fire", "water"], strong: "Brûlure + Gel. ", text: "Le tir garanti vaut dégâts × multiplicateur de brûlure × 1,5. L'explosion du couple n'a pas de montant publié." },
      { elements: ["earth", "air"], strong: "Putréfaction + Choc. ", text: "Chaque tick renvoie un éclair égal à la puissance déjà obtenue par ce tick, fois la magnitude de choc. Le second saut vaut la moitié." },
      { elements: ["earth", "water"], strong: "Putréfaction + Gel. ", text: "Sans brûlure, le tick et le total de la table prennent ×1,5. Le wiki dit aussi que ça dure plus longtemps, sans dire de combien : aucun tick n'est ajouté. Si la brûlure est déjà là, le ×1,5 est celui de Brûlure + Putréfaction et le gel n'est pas empilé une seconde fois." },
      { elements: ["water", "air"], strong: "Gel + Choc. ", text: "Les éclairs partent plus souvent. La fréquence n'est pas dans les tables." },
    ]));

    root.appendChild(guideBlock("Perles et arcanes", [
      "Ailment Power vaut ×1,25 sur le bonus, Acute Ailment ×2, les deux ×2,25. On part de la magnitude de base : une brûlure +25 % avec les deux perles devient 1 + 0,25 × 2,25 = 1,5625.",
      "Les totaux de ticks de la page Éléments incluent déjà +50 % de durée. Elemental Duration n'est pas réappliquée par-dessus.",
      "Basilisk, la marque de Nemesis, Parasite, Book of Serpents et Kirfane ignorent ces perles, en tout ou en partie.",
      "Un seul objet d'un élément ouvre sa pioche d'arcanes. En mettre deux ne rend pas cet élément plus probable. Hangfire est Feu sans être une source de Brûlure.",
    ]));
  }

    applyFilters(readLocalFilters());
    const params = new URLSearchParams(location.search);
    if (params.get("gnosis") != null) state.gnosis = Number(params.get("gnosis"));
    if (params.get("elements")) state.elements = params.get("elements").split(",").filter(Boolean);
    setupFilters();
    setupTabs();
    setupLab();
    setupAtelier();
    run();
    pullVault();
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) run();
    });
    if (params.get("open") === "1") {
      const first = document.querySelector("#builds .card");
      if (first) first.click();
    }
  })();
