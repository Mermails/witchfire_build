/* Moteur de déduction.
   Il ne classe pas une liste figée : il filtre le catalogue par Gnosis,
   cherche des équipements valides, choisit les perles en comparant les totaux,
   puis rédige la preuve à partir des formules du wiki. */
(function (root) {
  const DATA = root.WF_DATA;
  const byId = new Map();
  for (const list of [DATA.weapons, DATA.demonic, DATA.melee, DATA.spells, DATA.relics, DATA.rings, DATA.fetishes, DATA.beads]) {
    for (const item of list) byId.set(item.id, item);
  }

  function item(id) { return byId.get(id) || null; }

  function rosarySlots(gnosis) {
    if (gnosis <= 0) return 1;
    if (gnosis === 1) return 2;
    if (gnosis === 2) return 3;
    if (gnosis === 3 || gnosis === 4) return 4;
    return 5;
  }

  function phaseOf(gnosis) {
    if (gnosis <= 1) return { id: "debut", name: "Début" };
    if (gnosis <= 3) return { id: "milieu", name: "Milieu" };
    return { id: "fin", name: "Fin" };
  }

  function assumedMysterium(gnosis, override) {
    if (override && override !== "auto") return Number(override);
    if (gnosis <= 1) return 1;
    if (gnosis <= 3) return 2;
    return 3;
  }

  function owned(entry, gnosis) {
    return !!entry && entry.gnosis <= gnosis;
  }

  function mystLevel(entry, myst) {
    return Math.min(3, Math.max(1, myst));
  }

  function burnOf(entry, myst) {
    const burn = entry && entry.applies && entry.applies.burn;
    if (!burn || myst < (burn.from || 1)) return null;
    const table = burn.mag || {};
    const mag = table[myst] != null ? table[myst] : table[3] || 0;
    if (!mag) return null;
    return {
      item: entry,
      base: mag,
      bead: burn.bead !== false,
      reliable: burn.reliable == null ? 1 : burn.reliable,
      aoe: !!burn.aoe,
      note: burn.note || "",
    };
  }

  function decayOf(entry, myst) {
    const decay = entry && entry.applies && entry.applies.decay;
    if (!decay || myst < (decay.from || 1)) return null;
    return { item: entry, spec: decay, reliable: decay.reliable == null ? 1 : decay.reliable };
  }

  function shockOf(entry, myst) {
    const shock = entry && entry.applies && entry.applies.shock;
    if (!shock || myst < (shock.from || 1)) return null;
    return {
      item: entry,
      first: shock.first || 0,
      second: shock.second || (shock.first ? shock.first / 2 : 0),
      ailmentFirst: shock.ailmentFirst || 0,
      ailmentSecond: shock.ailmentSecond || 0,
      bead: shock.bead !== false && !shock.qualitative,
      qualitative: !!shock.qualitative,
      reliable: shock.reliable == null ? 1 : shock.reliable,
      note: shock.note || "",
    };
  }

  function freezeOf(entry, myst) {
    const freeze = entry && entry.applies && entry.applies.freeze;
    if (!freeze || myst < (freeze.from || 1)) return null;
    return { item: entry, reliable: freeze.reliable == null ? 1 : freeze.reliable, note: freeze.note || "" };
  }

  function beadMode(beads) {
    const ids = new Set(beads.map((b) => b.id));
    const power = ids.has("ailment-power");
    const acute = ids.has("acute-ailment");
    if (power && acute) return "both";
    if (power) return "power";
    if (acute) return "acute";
    return "none";
  }

  function burnMultiplier(base, beadScaled, mode) {
    if (!beadScaled) return 1 + base;
    let factor = 1;
    if (mode === "power") factor = 1.25;
    else if (mode === "acute") factor = 2;
    else if (mode === "both") factor = 2.25;
    return 1 + base * factor;
  }

  function decayRow(spec, mode, myst) {
    if (!spec.profile) return null;
    const table = DATA.decayTables[spec.profile];
    if (!table) return null;
    let chosen = table;
    if (spec.profile === "koschei" && myst < 3 && table.alt) chosen = table.alt;
    const row = chosen.rows[mode] || chosen.rows.none;
    return {
      label: chosen.label,
      tick: row[0],
      ticks: row[1],
      total: row[2],
      immune: !!chosen.immune || spec.bead === false,
      note: chosen.note || spec.note || "",
    };
  }

  function activeElements(loadout, myst) {
    const present = new Set();
    for (const piece of pieces(loadout)) {
      for (const el of piece.elements || []) present.add(el);
    }
    return present;
  }

  function pieces(loadout) {
    return ["primary", "secondary", "demonic", "melee", "light", "heavy", "relic", "fetish", "ring"]
      .map((key) => loadout[key])
      .filter(Boolean);
  }

  function applied(loadout, myst) {
    const burns = [];
    const decays = [];
    const shocks = [];
    const freezes = [];
    for (const piece of pieces(loadout)) {
      const b = burnOf(piece, myst);
      const d = decayOf(piece, myst);
      const s = shockOf(piece, myst);
      const f = freezeOf(piece, myst);
      if (b) burns.push(b);
      if (d) decays.push(d);
      if (s) shocks.push(s);
      if (f) freezes.push(f);
    }
    return { burns, decays, shocks, freezes };
  }

  function bestDecay(decays, mode, myst) {
    const ranked = decays.map((decay) => {
      const row = decayRow(decay.spec, decay.spec.bead === false ? "none" : mode, myst);
      const uptime = uptimeOf({ spec: decay.spec });
      const score = row ? row.total * uptime * (decay.reliable || 1) : 40 * (decay.reliable || 0.5);
      return { decay, row, score, uptime };
    }).sort((a, b) => b.score - a.score);
    return ranked[0] ? Object.assign(ranked[0], { others: ranked.slice(1) }) : null;
  }

  function bestBurn(burns, mode) {
    return burns.slice().sort((a, b) => {
      const left = burnMultiplier(a.base, a.bead, mode) * a.reliable + (a.aoe ? 0.03 : 0);
      const right = burnMultiplier(b.base, b.bead, mode) * b.reliable + (b.aoe ? 0.03 : 0);
      return right - left;
    })[0] || null;
  }

  function bestShock(shocks) {
    return shocks.slice().sort((a, b) => (b.first * b.reliable) - (a.first * a.reliable))[0] || null;
  }

  const GATE_KEYS = [
    ["flesh", "Chair"], ["blood", "Sang"], ["mind", "Esprit"],
    ["witchery", "Sorcellerie"], ["arsenal", "Arsenal"], ["faith", "Foi"],
  ];

  function beadGates(entry) {
    const need = {};
    const byName = {};
    for (const pair of GATE_KEYS) byName[pair[1]] = pair[0];
    const found = (entry && entry.found) || "";
    const re = /(Chair|Sang|Esprit|Sorcellerie|Arsenal|Foi)\s+(\d+)/g;
    let match = re.exec(found);
    while (match) {
      need[byName[match[1]]] = Number(match[2]);
      match = re.exec(found);
    }
    return need;
  }

  function attrsCover(need, attrs) {
    if (!attrs) return true;
    return Object.keys(need).every((key) => Number(attrs[key] || 0) >= need[key]);
  }

  function gateNeedText(need) {
    return GATE_KEYS.filter(([id]) => need[id]).map(([id, name]) => `${name} ${need[id]}`).join(", ");
  }

  function combinedHint(ids) {
    const need = {};
    for (const id of ids || []) {
      const bead = item(id);
      if (!bead) continue;
      const gates = beadGates(bead);
      for (const key of Object.keys(gates)) need[key] = Math.max(need[key] || 0, gates[key]);
    }
    return need;
  }

  function hintGapText(need, attrs) {
    const short = GATE_KEYS
      .filter(([id]) => need[id] && Number(attrs[id] || 0) < need[id])
      .map(([id, name]) => `${name} ${attrs[id] || 0} pour ${need[id]}`);
    return `Le rosaire cité demande ${gateNeedText(need)}. La transcendance est en dessous : ${short.join(", ")}. Le calcul retient des perles accessibles.`;
  }

  function publishedShockBurn(shockBase, burnBase, mode) {
    const key = `${Math.round(shockBase * 1000)}-${Math.round(burnBase * 1000)}`;
    const table = {
      "300-250": { none: 1, power: 1.26, acute: 2.72, both: 3.27 },
      "300-375": { none: 1.19, power: 1.64, acute: 3.45, both: 4.19 },
      "375-250": { none: 1.26, power: 1.69, acute: 3.4, both: 4.09 },
      "375-375": { none: 1.49, power: 2.05, acute: 4.32, both: 5.24 },
      "600-250": { none: 2, power: 2.71, acute: 5.45, both: 6.55 },
      "600-375": { none: 2.38, power: 3.29, acute: 6.91, both: 8.39 },
    };
    const row = table[key];
    return row ? row[mode] : null;
  }

  function burnSpread(burn) {
    return ["none", "power", "acute", "both"].map((mode) => {
      const mult = burnMultiplier(burn.base, burn.bead, mode);
      return `${modeLabel(mode)} ${fmt((mult - 1) * 100, 2)} %`;
    }).join(", ");
  }

  function computeMath(loadout, beads, myst, shotOverride) {
    const mode = beadMode(beads);
    const got = applied(loadout, myst);
    const decay = bestDecay(got.decays, mode, myst);
    const burn = bestBurn(got.burns, mode);
    const shock = bestShock(got.shocks);
    const freeze = got.freezes.slice().sort((a, b) => b.reliable - a.reliable)[0] || null;
    const lines = [];
    let comboTotal = 0;
    let comboTick = 0;
    let shockChain = 0;
    let shockSecond = 0;
    let shockFirst = 0;
    let shockShot = 0;
    let tickShock = 0;
    let tickShockSecond = 0;
    let tickShockTotal = 0;
    let tickShockSecondTotal = 0;
    let takenBurn = 0;
    let takenFreeze = 0;
    let takenBurnFreeze = 0;
    let packageScore = 0;
    let kind = "aucun";
    const shot = shotOverride > 0 ? shotOverride : referenceShot(loadout);

    if (decay && decay.row && burn) {
      const mult = burnMultiplier(burn.base, burn.bead, mode);
      comboTick = decay.row.tick * mult * 1.5;
      comboTotal = decay.row.total * mult * 1.5;
      kind = "burn-decay";
      lines.push({
        title: "Chiffres de putréfaction",
        text: `${decay.row.label} : ${fmt(decay.row.tick)} dégâts par tick, ${decay.row.ticks} ticks, ${fmt(decay.row.total)} au total sur la table du wiki pour le réglage « ${modeLabel(mode)} ».`,
      });
      lines.push({
        title: "Chiffres de brûlure",
        text: `${burn.item.name} pose une brûlure de base +${pct(burn.base)}. ${burn.bead ? "Les perles la renforcent." : "Cette brûlure ignore les perles."} Multiplicateur retenu : ×${fmt(mult, 4)} (1 + bonus). Table des magnitudes : ${burnSpread(burn)}.`,
      });
      lines.push({
        title: "Règle Brûlure + Putréfaction",
        text: `Formule du wiki : tick × multiplicateur de brûlure × 1,5. Tick retenu : ${fmt(decay.row.tick)} × ${fmt(mult, 4)} × 1,5 = ${fmt(comboTick)}. Le total de la table, ${fmt(decay.row.total)}, passe à ${fmt(comboTotal)} avec le même facteur.`,
      });
      if (decay.row.note) lines.push({ title: "Limite de la table", text: decay.row.note });
      lines.push({
        title: "Ce que le total ne refait pas",
        text: "Ces nombres de ticks incluent déjà, sur la page Éléments, une mesure à +50 % de durée. La perle Elemental Duration n'est pas réappliquée par-dessus. Deux putréfactions ne sont pas additionnées.",
      });
      if (decay.others && decay.others.length) {
        lines.push({
          title: "Autres sources de putréfaction",
          text: decay.others.map((other) => other.row
            ? `${other.decay.item.name} : ${fmt(other.row.total)} au total de la table, couverture ${fmt(other.uptime, 2)}.`
            : `${other.decay.item.name} applique la putréfaction sans total publié.`).join(" "),
        });
      }
    } else if (decay && decay.row) {
      comboTotal = decay.row.total;
      comboTick = decay.row.tick;
      kind = "decay";
      lines.push({
        title: "Putréfaction seule",
        text: `${decay.row.label} : ${fmt(decay.row.tick)} par tick, ${decay.row.ticks} ticks, ${fmt(decay.row.total)} au total (${modeLabel(mode)}). Sans brûlure, le ×1,5 ne s'applique pas.`,
      });
    } else if (burn) {
      kind = "burn";
      const mult = burnMultiplier(burn.base, burn.bead, mode);
      lines.push({
        title: "Brûlure seule",
        text: `${burn.item.name} fait subir ×${fmt(mult, 3)} aux dégâts (${pct(mult - 1)} de plus). Le wiki l'écrit ainsi : dégâts du tir × magnitude. Table des magnitudes : ${burnSpread(burn)}. Les arcanes Accelerant et Pyrolysis s'ajoutent ensuite, environ +15 % chacun au départ.`,
      });
    }

    if (burn && burn.item.id === "pyre-skull") {
      const steps = [1, 2, 3, 4, 5].map((kills) => {
        const base = 0.25 * (1 + 0.25 * kills);
        return `${kills} ${kills > 1 ? "kills" : "kill"} ${fmt(base * 100, 2)} %`;
      });
      lines.push({
        title: "Pyre Skull au troisième palier",
        text: `Chaque kill ajoute 25 % de magnitude, jusqu'à cinq, avant les perles : ${steps.join(", ")}. Le calcul du build retient la magnitude de base, pas un nombre de kills inventé.`,
      });
    }

    const mags = shockMagnitudes(shock, mode);
    if (burn && mags) {
      const first = mags.first;
      const bMult = burnMultiplier(burn.base, burn.bead, mode);
      const beadFactor = burn.bead ? ailmentFactor(mode) : 1;
      const ailmentBase = shock.ailmentFirst || shock.first;
      shockChain = shot * first * 2.1 * bMult;
      shockSecond = shockChain / 2;
      const chainSolo = shot * first * 2.1;
      shockShot = shot + shot * burn.base * beadFactor * 2.3;
      lines.push({
        title: "Règle Brûlure + Choc",
        text: `Premier éclair si le groupe brûle : ${fmt(shot)} × ${fmt(first, 3)} × 2,1 × ${fmt(bMult, 3)} = ${fmt(shockChain)}. Le second saut vaut la moitié, ${fmt(shockChain / 2)}. Si seule la cible principale porte les deux malus, la magnitude de brûlure compte pour 1 : ${fmt(chainSolo)}.`,
      });
      lines.push({
        title: "Tir sous Brûlure + Choc",
        text: `Le tir augmente : ${fmt(shot)} + (${fmt(shot)} × ${fmt(burn.base, 4)} × ${fmt(beadFactor, 2)} × 2,3) = ${fmt(shockShot)}.`,
      });
      const published = publishedShockBurn(ailmentBase, burn.base, mode);
      if (published) {
        lines.push({
          title: "Table Brûlure + Choc",
          text: `Pour une chaîne de base ${pct(ailmentBase)} et une brûlure de base ${pct(burn.base)}, la table du wiki donne ×${fmt(published, 2)} avec le réglage « ${modeLabel(mode)} ».`,
        });
      }
      if (shock.ailmentFirst && Math.abs(shock.first - shock.ailmentFirst) > 0.01) {
        const chainSecond = shock.ailmentSecond || shock.second || ailmentBase / 2;
        lines.push({
          title: "Chaîne à part",
          text: `${shock.item.name} a aussi une chaîne de ${pct(shock.first)} puis ${pct(shock.second || shock.first / 2)}. Elle n'est pas le Choc que les perles renforcent. Le second saut de ce Choc-là part de ${pct(chainSecond)}.`,
        });
      }
      if (kind === "aucun" || kind === "burn") kind = "burn-shock";
    } else if (mags) {
      const ailmentBase = shock.ailmentFirst || shock.first;
      const ailmentSecond = shock.ailmentSecond || shock.second || ailmentBase / 2;
      shockFirst = shot * mags.first;
      shockSecond = shot * mags.second;
      lines.push({
        title: "Choc",
        text: `${shock.item.name} : premier saut ${pct(ailmentBase)} du tir, second ${pct(ailmentSecond)}. Sur un tir de ${fmt(shot)}, avec « ${modeLabel(mode)} » : ${fmt(shockFirst)} puis ${fmt(shockSecond)}.`,
      });
      if (kind === "aucun") kind = "shock";
    }

    const burnMult = burn ? burnMultiplier(burn.base, burn.bead, mode) : 1;
    if (burn) takenBurn = shot * burnMult;
    if (freeze) takenFreeze = shot * 1.5;
    if (burn && freeze) takenBurnFreeze = shot * burnMult * 1.5;

    if (freeze && decay && decay.row && !burn) {
      comboTick = decay.row.tick * 1.5;
      comboTotal = decay.row.total * 1.5;
      kind = "decay-freeze";
      lines.push({
        title: "Putréfaction sur un gelé",
        text: `Le tick subit +50 %, comme les autres dégâts sur un gelé. ${fmt(decay.row.tick)} × 1,5 = ${fmt(comboTick)}. Sur les ${decay.row.ticks} ticks de la table, le total passe de ${fmt(decay.row.total)} à ${fmt(comboTotal)}. Le gel allonge aussi la putréfaction, mais cette durée n'a pas de coefficient : elle n'est pas ajoutée.`,
      });
    }

    if (freeze) {
      const guaranteed = burn
        ? ` Avec la brûlure, le tir garanti vaut ${fmt(shot)} × ${fmt(burnMult, 3)} × 1,5 = ${fmt(takenBurnFreeze)}. L'explosion du couple n'a pas de montant publié, elle n'est pas dans ce chiffre.`
        : "";
      lines.push({
        title: "Gel",
        text: `${freeze.item.name} immobilise. Un ennemi gelé subit +50 % de dégâts, et ce bonus ignore les perles. Sur ce tir de ${fmt(shot)} : ${fmt(takenFreeze)}.${guaranteed} ${freeze.note || "La perle Acute raccourcit le gel sans le rendre plus fort."}`,
      });
      if (kind === "aucun") kind = "freeze";
      else if (kind === "burn") kind = "burn-freeze";
      else if (kind === "burn-shock") kind = "burn-shock-freeze";
    }

    if (decay && decay.row && mags) {
      tickShock = comboTick * mags.first;
      tickShockSecond = comboTick * mags.second;
      tickShockTotal = tickShock * decay.row.ticks;
      tickShockSecondTotal = tickShockSecond * decay.row.ticks;
      if (burn) kind = "burn-decay-shock";
      else if (kind === "decay" || kind === "decay-freeze") kind = `${kind}-shock`;
      lines.push({
        title: "Éclair hérité du tick",
        text: `Chaque tick de putréfaction déclenche un choc, qui reprend la puissance déjà obtenue par le tick. Premier éclair : ${fmt(comboTick)} × ${fmt(mags.first, 3)} = ${fmt(tickShock)}. Second saut : ${fmt(tickShockSecond)}. Sur ${decay.row.ticks} ticks : ${fmt(tickShockTotal)}, puis ${fmt(tickShockSecondTotal)} sur les cibles du second saut. Conductor, si vous le piochez, fait voyager les malus de la source avec la foudre.`,
      });
    } else if (decay && shock && shock.qualitative) {
      lines.push({
        title: "Putréfaction + Choc",
        text: "Chaque tick de putréfaction émet un éclair. Cette source de choc n'a pas de magnitude chiffrée, donc l'éclair du tick n'est pas calculé. Conductor, si vous le piochez, fait voyager les malus de la source avec la foudre.",
      });
    }

    if (decay && freeze && burn) {
      lines.push({
        title: "Putréfaction, brûlure et gel",
        text: `Le ×1,5 du tick est celui de Brûlure + Putréfaction. Le +50 % du gel n'est pas empilé une seconde fois sur ce tick : les deux formules ne sont pas publiées ensemble. Le tir, lui, prend les deux : ${fmt(takenBurnFreeze)}.`,
      });
    }

    if (freeze && shock && !decay) {
      lines.push({
        title: "Gel + Choc",
        text: "Les éclairs partent plus souvent. La fréquence exacte n'est pas dans les tables. Le montant de chaque éclair reste celui calculé plus haut.",
      });
    }

    if (decay && decay.row) {
      packageScore = comboTotal + tickShockTotal + tickShockSecondTotal;
    } else if (shockChain) {
      packageScore = shockChain + shockSecond;
      if (takenBurnFreeze) packageScore += takenBurnFreeze - shot;
    } else if (shockFirst) {
      packageScore = shockFirst + shockSecond;
      if (freeze) packageScore += shot * 0.5;
    } else if (takenBurnFreeze) {
      packageScore = takenBurnFreeze - shot;
    } else if (takenBurn) {
      packageScore = takenBurn - shot;
    } else if (takenFreeze) {
      packageScore = shot * 0.5;
    }

    const elementSet = activeElements(loadout, myst);
    lines.push({
      title: "Pioche d'arcanes",
      text: elementSet.size
        ? `Éléments présents dans l'équipement : ${[...elementSet].map((id) => DATA.EL[id].name).join(", ")}. Chaque élément représenté a la même chance. Équiper deux objets du même élément ne favorise pas cet élément.`
        : "Aucun élément dans l'équipement : la pioche d'arcanes élémentaires reste fermée.",
    });

    return {
      mode, decay, burn, shock, freeze, lines, comboTotal, comboTick,
      shockChain, shockSecond, shockFirst, shockShot,
      tickShock, tickShockSecond, tickShockTotal, tickShockSecondTotal,
      takenBurn, takenFreeze, takenBurnFreeze,
      package: packageScore, kind, elements: [...elementSet],
    };
  }

  function referenceShot(loadout) {
    const gun = loadout.primary || loadout.secondary;
    if (!gun || !gun.stats) return 20;
    return gun.stats.damage || 20;
  }

  function shockMagnitudes(shock, mode) {
    if (!shock || shock.qualitative || !(shock.ailmentFirst || shock.first)) return null;
    const base = shock.ailmentFirst || shock.first;
    const secondBase = shock.ailmentSecond || shock.second || base / 2;
    const scales = shock.ailmentFirst ? true : !!shock.bead;
    const factor = scales ? ailmentFactor(mode) : 1;
    return { first: base * factor, second: secondBase * factor };
  }

  function ailmentFactor(mode) {
    if (mode === "power") return 1.25;
    if (mode === "acute") return 2;
    if (mode === "both") return 2.25;
    return 1;
  }

  function modeLabel(mode) {
    if (mode === "power") return "Ailment Power";
    if (mode === "acute") return "Acute Ailment";
    if (mode === "both") return "Ailment Power + Acute";
    return "sans perle de malus";
  }

  const UPTIME = {
    rotweaver: 1, stigma: 0.9, eye: 0.75, cyst: 0.7, judgment: 0.65, koschei: 0.6,
    fiend: 0.62, miasma: 0.42, excreta: 0.4, book: 0.3, parasite: 0.8,
  };

  function uptimeOf(decay) {
    if (!decay || !decay.spec || !decay.spec.profile) return 0.6;
    return UPTIME[decay.spec.profile] == null ? 0.7 : UPTIME[decay.spec.profile];
  }

  function packageOnly(loadout, beads, myst) {
    const mode = beadMode(beads);
    const got = applied(loadout, myst);
    const decay = bestDecay(got.decays, mode, myst);
    const burn = bestBurn(got.burns, mode);
    const shock = bestShock(got.shocks);
    const freeze = got.freezes.slice().sort((a, b) => b.reliable - a.reliable)[0] || null;
    const shot = referenceShot(loadout);
    let comboTotal = 0;
    let comboTick = 0;
    let shockChain = 0;
    let shockSecond = 0;
    let shockFirst = 0;
    let tickShockTotal = 0;
    let tickShockSecondTotal = 0;
    let takenBurnFreeze = 0;
    let takenBurn = 0;
    let packageScore = 0;
    const mags = shockMagnitudes(shock, mode);
    if (decay && decay.row && burn) {
      const mult = burnMultiplier(burn.base, burn.bead, mode);
      comboTick = decay.row.tick * mult * 1.5;
      comboTotal = decay.row.total * mult * 1.5;
    } else if (decay && decay.row) {
      comboTotal = decay.row.total;
      comboTick = decay.row.tick;
    }
    if (burn && mags) {
      const bMult = burnMultiplier(burn.base, burn.bead, mode);
      shockChain = shot * mags.first * 2.1 * bMult;
      shockSecond = shockChain / 2;
    } else if (mags) {
      shockFirst = shot * mags.first;
      shockSecond = shot * mags.second;
    }
    const burnMult = burn ? burnMultiplier(burn.base, burn.bead, mode) : 1;
    if (burn) takenBurn = shot * burnMult;
    if (burn && freeze) takenBurnFreeze = shot * burnMult * 1.5;
    if (freeze && decay && decay.row && !burn) {
      comboTick = decay.row.tick * 1.5;
      comboTotal = decay.row.total * 1.5;
    }
    if (decay && decay.row && mags) {
      tickShockTotal = comboTick * mags.first * decay.row.ticks;
      tickShockSecondTotal = comboTick * mags.second * decay.row.ticks;
    }
    if (decay && decay.row) packageScore = comboTotal + tickShockTotal + tickShockSecondTotal;
    else if (shockChain) {
      packageScore = shockChain + shockSecond;
      if (takenBurnFreeze) packageScore += takenBurnFreeze - shot;
    } else if (shockFirst) {
      packageScore = shockFirst + shockSecond;
      if (freeze) packageScore += shot * 0.5;
    } else if (takenBurnFreeze) packageScore = takenBurnFreeze - shot;
    else if (takenBurn) packageScore = takenBurn - shot;
    else if (freeze) packageScore = shot * 0.5;
    return { package: packageScore, mode, decay, freeze };
  }

  function chooseBeads(loadout, slotCount, myst, style, gnosis, attrs) {
    const got = applied(loadout, myst);
    const hasShotgun = pieces(loadout).some((p) => p.stats && p.stats.unwieldy === "shotgun");
    const hasSniper = pieces(loadout).some((p) => p.stats && p.stats.unwieldy === "sniper");
    const dash = loadout.ring && loadout.ring.applies && loadout.ring.applies.dash;
    const slide = loadout.ring && loadout.ring.applies && loadout.ring.applies.slide;
    const want = new Set(["spell-recharge", "stamina", "elemental-duration"]);
    if (got.burns.length || got.decays.length || got.shocks.length) {
      want.add("ailment-power");
      want.add("acute-ailment");
    }
    if (hasShotgun) want.add("short-range");
    if (hasSniper) want.add("long-range");
    if (dash || slide) want.add("dash-stamina");
    if (style === "distance" || style === "boss") want.add("blessed-aim");
    if (style === "survie") want.add("healing");
    if (loadout.light && loadout.light.spellType === "light") want.add("light-charge");
    const candidates = DATA.beads.filter((b) => b.gnosis <= gnosis && want.has(b.id) && attrsCover(beadGates(b), attrs));
    const utilityOf = (bead) => {
      let score = (bead.utility || 0) * 12;
      if (bead.tags.shotgun && hasShotgun) score += 80;
      if (bead.tags.sniper && hasSniper) score += 70;
      if (bead.tags.dash && dash) score += style === "survie" ? 60 : 35;
      if (bead.tags.duration && (got.decays.length || got.freezes.length)) score += 25;
      if (bead.tags.survival && style === "survie") score += 40;
      if (bead.tags.crit && style === "distance") score += 20;
      if (bead.tags.spells && (loadout.light || loadout.heavy)) score += 15;
      if (bead.id === "acute-ailment" && got.freezes.length && !got.decays.length) score -= 50;
      return score;
    };
    const scoreSet = (set) => {
      const rough = packageOnly(loadout, set, myst);
      const timed = !!(rough.decay && rough.decay.row);
      let score = (rough.package || 0) * (timed ? uptimeOf(rough.decay && rough.decay.decay) : 1);
      for (const bead of set) score += utilityOf(bead);
      if (rough.freeze && rough.mode === "acute") score -= 30;
      return score;
    };
    const k = Math.min(slotCount, candidates.length);
    const power = candidates.find((bead) => bead.id === "ailment-power") || null;
    const acute = candidates.find((bead) => bead.id === "acute-ailment") || null;
    const fillers = candidates
      .filter((bead) => bead.id !== "ailment-power" && bead.id !== "acute-ailment")
      .map((bead, index) => ({ bead, index, utility: utilityOf(bead) }))
      .sort((a, b) => b.utility - a.utility || a.index - b.index);
    const modes = [
      { required: [] },
      power ? { required: [power] } : null,
      acute ? { required: [acute] } : null,
      power && acute ? { required: [power, acute] } : null,
    ];
    let best = { beads: [], score: scoreSet([]) };
    if (k > 0) {
      for (const spec of modes) {
        if (!spec || spec.required.length > k) continue;
        const need = k - spec.required.length;
        if (need > fillers.length) continue;
        const set = spec.required.concat(fillers.slice(0, need).map((row) => row.bead));
        const score = scoreSet(set);
        if (score > best.score) best = { beads: set, score };
      }
    }
    best.math = computeMath(loadout, best.beads, myst);
    return best;
  }

  /* Rangs subjectifs, petit écart seulement (S +14, A +9, B +5, C 0, D −4). Jamais affichés.
     Armes classées dans la tier list YouTube Webgrave (fin de partie) : https://www.youtube.com/watch?v=vFq3sboueZY
     Fatum, Martyr, Corpse Eater, démoniaques et mêlée absents de cette vidéo : panorama récent
     https://www.reddit.com/r/Witchfire/comments/1vvb3hk/witchfire_weapon_overview_tier_list_opinions/
     Tribunal, Soul Eater, Heart Eater et Morning Star n'y figurent pas : rang C, aucun bonus.
     Sorts : piliers cités dans les builds récents (SeraphMax, fils actuels). Le reste reste neutre.
     Reliques, anneaux, fétiches : guide d'équipement, 83 avis, août 2025
     https://steamcommunity.com/sharedfiles/filedetails/?id=3452118540
     Biting Tongue est dans un build du haut du classement SeraphMax, pas dans ce guide. */
  const ITEM_RANK = {
    hunger: "S", echo: "A", angelus: "B", psychopomp: "D", hailstorm: "D", hangfire: "B",
    hypnosis: "A", frostbite: "A", basilisk: "C", duelist: "C", ricochet: "D", koschei: "B",
    "corpse-eater": "B", oracle: "C", cricket: "C", midas: "D", nemesis: "A", "all-seeing-eye": "D",
    martyr: "B", fatum: "A", striga: "S", rotweaver: "D", judgment: "B", tribunal: "C",
    "falling-star": "S", vulture: "S", whisper: "B", "soul-eater": "C", tempest: "A", "heart-eater-standin": "C",
    fist: "A", katar: "B", "morning-star": "C", buckler: "C", "sacring-bell": "S", zweihander: "A",
    fireballs: "B", firebreath: "A", "frost-cone": "A", shockwave: "B", "winter-nail": "C",
    "blight-cyst": "A", "ice-stiletto": "C", "lightning-bolt": "B", stigma: "B", "cursed-bell": "C",
    "iron-cross": "A", stormball: "A", "burning-stake": "S", "ice-sphere": "A", "rotten-fiend": "A",
    cornucopia: "B", miasma: "B", "pyre-skull": "C", twinshade: "C",
    "severed-ear": "B", "biting-tongue": "B", kirfane: "B", parasite: "B", "book-of-serpents": "C",
    "eye-of-the-madwoman": "A", braid: "C", "blood-banshee": "A", "painted-tooth": "B", scourge: "C",
    "static-ring": "C", "crown-of-fire": "B", "dynamo-ring": "C", "meteor-ring": "C", "ring-of-excreta": "B",
    "ring-of-thorns": "B", "ring-of-wings": "A", "shadowmist-ring": "A", "ring-of-obedience": "C",
    mandrake: "C", belladonna: "A", bittersweet: "C", monkshood: "B", henbane: "A", balewort: "B", yew: "C",
  };
  const RANK_WEIGHT = { S: 14, A: 9, B: 5, C: 0, D: -4 };

  function rankWeight(entry) {
    if (!entry) return 0;
    const rank = ITEM_RANK[entry.id];
    return rank ? RANK_WEIGHT[rank] : 0;
  }

  function sustainedDps(gun) {
    if (!gun || !gun.stats || gun.slot === "melee") return 0;
    const damage = gun.stats.damage || 0;
    const rof = gun.stats.rof || 0;
    const mag = gun.stats.mag || 0;
    const reload = gun.stats.reload || 0;
    if (!(damage > 0) || !(rof > 0) || !(mag > 0)) return 0;
    const cycle = mag / rof + Math.max(0, reload);
    return cycle > 0 ? (damage * mag) / cycle : 0;
  }

  function firepower(loadout) {
    let total = 0;
    if (loadout.primary) total += sustainedDps(loadout.primary);
    if (loadout.secondary) total += sustainedDps(loadout.secondary);
    if (loadout.demonic) total += sustainedDps(loadout.demonic) * 0.4;
    return total;
  }

  function opinion(loadout) {
    let total = 0;
    for (const key of ["primary", "secondary", "demonic", "melee", "light", "heavy", "relic", "ring", "fetish"]) {
      total += rankWeight(loadout[key]);
    }
    return total;
  }

  function unrankedItems() {
    const pools = [DATA.weapons, DATA.demonic, DATA.melee, DATA.spells, DATA.relics, DATA.rings, DATA.fetishes];
    const missing = [];
    for (const pool of pools) {
      for (const entry of pool) if (!ITEM_RANK[entry.id]) missing.push(entry.id);
    }
    return missing;
  }

  function weaponScore(gun, plan, myst, style) {
    if (!gun) return 0;
    const fire = sustainedDps(gun);
    let score = fire * 0.2 + rankWeight(gun);
    if (plan.has("fire") && burnOf(gun, myst)) score += 80 * burnOf(gun, myst).base * 10 * (burnOf(gun, myst).reliable || 1);
    if (plan.has("earth") && decayOf(gun, myst)) score += 70;
    if (plan.has("air") && shockOf(gun, myst)) score += 50 * (shockOf(gun, myst).first || 0.2) * 10;
    if (plan.has("water") && freezeOf(gun, myst)) score += 40;
    for (const el of gun.elements || []) if (plan.has(el)) score += 8;
    if (style === "distance" && gun.range === "long") score += 25;
    if (style === "survie" && gun.range === "long") score += 35;
    if (style === "survie" && gun.stats && gun.stats.unwieldy === "sniper") score += 25;
    if (style === "survie" && gun.stats && (gun.stats.stun === "élevé" || gun.stats.stun === "très élevé")) score += 12;
    if (style === "corps" && gun.range === "close") score += 25;
    if (style === "tir") score += fire * 0.12;
    if (style === "foules" && gun.range === "close") score += 10;
    return score;
  }

  function pieceScore(entry, plan, myst) {
    if (!entry) return 0;
    let score = 0;
    const b = burnOf(entry, myst);
    const d = decayOf(entry, myst);
    const s = shockOf(entry, myst);
    const f = freezeOf(entry, myst);
    if (plan.has("fire") && b) score += 100 * b.base * 8 * b.reliable + (b.aoe ? 25 : 0);
    if (plan.has("earth") && d) score += 90 * (d.reliable || 1);
    if (plan.has("air") && s) score += 80 * (s.first || 0.2) * s.reliable;
    if (plan.has("water") && f) score += 70 * f.reliable;
    for (const el of entry.elements || []) if (plan.has(el) && score < 20) score += 6;
    score += rankWeight(entry);
    return score;
  }

  function rank(list, plan, myst, style, limit) {
    return list
      .map((entry) => ({ entry, score: entry.slot === "weapon" || entry.demonic ? weaponScore(entry, plan, myst, style) : pieceScore(entry, plan, myst) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((row) => row.entry);
  }

  function appliesPlan(entry, plan, myst) {
    if (plan.has("fire") && burnOf(entry, myst)) return true;
    if (plan.has("earth") && decayOf(entry, myst)) return true;
    if (plan.has("air") && shockOf(entry, myst) && !shockOf(entry, myst).qualitative) return true;
    if (plan.has("water") && freezeOf(entry, myst)) return true;
    return false;
  }

  function preferApplied(list, plan, myst, style, limit) {
    const ranked = rank(list, plan, myst, style, list.length || limit);
    const applied = [];
    const rest = [];
    for (const entry of ranked) {
      if (appliesPlan(entry, plan, myst)) applied.push(entry);
      else rest.push(entry);
    }
    return applied.concat(rest).slice(0, limit);
  }

  function evaluate(loadout, plan, myst, gnosis, style, slotCount, attrs) {
    const beadPick = chooseBeads(loadout, slotCount, myst, style, gnosis, attrs);
    const math = beadPick.math;
    const got = applied(loadout, myst);
    let score = beadPick.score + firepower(loadout) + opinion(loadout);
    const guns = [loadout.primary, loadout.secondary].filter(Boolean);
    const ranges = new Set(guns.map((g) => g.range));
    if (ranges.has("close") && (ranges.has("medium") || ranges.has("long"))) score += 30;
    if (guns.length < 2) score -= 25;
    const safety = (loadout.fetish && loadout.fetish.safety || 0) + (loadout.ring && loadout.ring.id === "shadowmist-ring" ? 3 : 0);
    score += safety * (style === "survie" ? 40 : 12);
    if (style === "boss") {
      score += guns.some((g) => g.range === "long") ? 35 : 0;
      score += math.decay && math.decay.row ? math.decay.row.tick * 4 : 0;
    }
    if (style === "foules") {
      score += (math.burn && math.burn.aoe) ? 40 : 0;
      score += loadout.light && loadout.light.id === "stormball" ? 20 : 0;
    }
    if (style === "distance") score += guns.some((g) => g.range === "long") ? 40 : -15;
    if (style === "corps") score += guns.some((g) => g.range === "close") ? 30 : -10;
    if (style === "survie") {
      const snipers = guns.filter((g) => g.stats && g.stats.unwieldy === "sniper").length;
      score += snipers * 30;
      if (snipers >= 2) score += 55;
    }
    if (loadout.melee && guns.some((gun) => gun.id === "psychopomp")) score += 20;
    const have = new Set(math.elements);
    let covered = 0;
    for (const el of plan) if (have.has(el) || elementApplied(el, got)) covered++;
    score += covered * 20;
    if (have.size > plan.size + 1) score -= (have.size - plan.size) * 8;
    const reliableBurn = got.burns.some((b) => b.reliable >= 0.8);
    const reliableDecay = got.decays.some((d) => (d.reliable || 1) >= 0.8);
    if (plan.has("fire") && plan.has("earth") && reliableBurn && reliableDecay) score += 45;
    return { loadout, beads: beadPick.beads, math, score, plan: [...plan], safety };
  }

  function elementApplied(el, got) {
    if (el === "fire") return got.burns.length > 0;
    if (el === "earth") return got.decays.length > 0;
    if (el === "air") return got.shocks.length > 0;
    if (el === "water") return got.freezes.length > 0;
    return false;
  }

  function plansFor(elements) {
    const all = [
      ["fire", "earth"],
      ["fire", "air"],
      ["fire", "water"],
      ["earth", "air"],
      ["earth", "water"],
      ["water", "air"],
      ["fire", "earth", "air"],
      ["water", "earth", "air"],
      ["fire", "earth", "water"],
      ["fire"],
      ["earth"],
      ["air"],
      ["water"],
    ];
    if (!elements || !elements.length) return all.filter((p) => p.length >= 2).map((p) => new Set(p));
    return all.filter((p) => elements.every((el) => p.includes(el))).map((p) => new Set(p));
  }

  function pool(gnosis) {
    return {
      weapons: DATA.weapons.concat(DATA.demonic.filter((w) => !w.demonic)).filter((w) => w.gnosis <= gnosis),
      demonic: DATA.demonic.filter((w) => w.demonic && w.gnosis <= gnosis),
      lights: DATA.spells.filter((s) => s.spellType === "light" && s.gnosis <= gnosis),
      heavies: DATA.spells.filter((s) => s.spellType === "heavy" && s.gnosis <= gnosis),
      relics: DATA.relics.filter((s) => s.gnosis <= gnosis),
      rings: DATA.rings.filter((s) => s.gnosis <= gnosis),
      fetishes: DATA.fetishes.filter((s) => s.gnosis <= gnosis),
      melee: DATA.melee.filter((s) => s.gnosis <= gnosis),
    };
  }

  function pickMelee(list, style, loadout) {
    if (!list.length) return null;
    const ids = new Set([loadout && loadout.primary, loadout && loadout.secondary, loadout && loadout.demonic].filter(Boolean).map((gun) => gun.id));
    const prefer = ids.has("psychopomp") ? ["katar", "morning-star", "fist", "buckler"]
      : ids.has("whisper") || style === "boss" || style === "corps" ? ["morning-star", "katar", "buckler", "fist"]
      : style === "survie" ? ["buckler", "katar", "fist", "morning-star"]
      : style === "distance" ? ["katar", "buckler", "morning-star", "fist"]
      : ["katar", "morning-star", "buckler", "fist"];
    for (const id of prefer) {
      const found = list.find((entry) => entry.id === id);
      if (found) return found;
    }
    return list[0];
  }

  function attachMelee(loadout, list, style, weaponId) {
    if (loadout.melee) return loadout;
    if (weaponId) {
      const forced = list.find((entry) => entry.id === weaponId);
      if (forced) { loadout.melee = forced; return loadout; }
    }
    loadout.melee = pickMelee(list, style, loadout);
    return loadout;
  }

  function pickFetish(list, style) {
    if (!list.length) return null;
    const order = style === "survie"
      ? ["mandrake", "henbane", "balewort", "yew", "monkshood", "belladonna", "bittersweet"]
      : ["mandrake", "henbane", "yew", "monkshood", "belladonna", "balewort", "bittersweet"];
    for (const id of order) {
      const found = list.find((f) => f.id === id);
      if (found) return found;
    }
    return list[0];
  }

  function pickDemonic(list, style) {
    if (!list.length) return null;
    const prefer = style === "foules" ? ["falling-star", "vulture", "whisper", "soul-eater", "tempest"]
      : style === "boss" ? ["vulture", "whisper", "soul-eater", "falling-star", "tempest"]
      : ["vulture", "whisper", "falling-star", "soul-eater", "tempest"];
    for (const id of prefer) {
      const found = list.find((d) => d.id === id);
      if (found) return found;
    }
    return list[0];
  }

  function searchPlan(plan, gnosis, myst, style, slotCount, weaponId, attrs) {
    const src = pool(gnosis);
    let weapons = preferApplied(src.weapons, plan, myst, style, style === "survie" ? 10 : 8);
    if (style === "survie") {
      for (const id of ["hailstorm", "oracle", "frostbite"]) {
        const gun = src.weapons.find((w) => w.id === id);
        if (gun && !weapons.some((w) => w.id === id)) weapons.push(gun);
      }
    }
    if (weaponId) {
      const forced = src.weapons.find((w) => w.id === weaponId) || DATA.demonic.find((w) => w.id === weaponId && w.gnosis <= gnosis);
      if (forced && forced.slot === "weapon" && !weapons.some((w) => w.id === forced.id)) weapons.unshift(forced);
    }
    const lights = preferApplied(src.lights, plan, myst, style, 4);
    const heavies = preferApplied(src.heavies, plan, myst, style, 4);
    const relics = preferApplied(src.relics, plan, myst, style, 1);
    const rings = preferApplied(src.rings, plan, myst, style, 2);
    const fetish = pickFetish(src.fetishes, style);
    let demonic = pickDemonic(src.demonic, style);
    if (weaponId) {
      const forcedDemonic = src.demonic.find((entry) => entry.id === weaponId);
      if (forcedDemonic) demonic = forcedDemonic;
    }
    const forcedMelee = weaponId ? src.melee.find((entry) => entry.id === weaponId) : null;
    const found = [];
    const lightList = lights.length ? lights : [null];
    const heavyList = heavies.length ? heavies : [null];
    const relicList = relics.length ? relics : [null];
    const ringList = rings.length ? rings : [null];
    for (let i = 0; i < weapons.length; i++) {
      for (let j = i + 1; j < weapons.length; j++) {
        const pair = orderGuns(weapons[i], weapons[j], style);
        for (const light of lightList) {
          for (const heavy of heavyList) {
            for (const relic of relicList) {
              for (const ring of ringList) {
                const loadout = attachMelee({ primary: pair[0], secondary: pair[1], demonic, light, heavy, relic, fetish, ring, melee: forcedMelee }, src.melee, style, weaponId);
                if (weaponId && !pieces(loadout).some((p) => p.id === weaponId)) continue;
                found.push(evaluate(loadout, plan, myst, gnosis, style, slotCount, attrs));
              }
            }
          }
        }
      }
    }
    if (weapons.length === 1) {
      for (const light of lightList) {
        for (const heavy of heavyList) {
          for (const relic of relicList) {
            for (const ring of ringList) {
              found.push(evaluate(attachMelee({ primary: weapons[0], secondary: null, demonic, light, heavy, relic, fetish, ring, melee: forcedMelee }, src.melee, style, weaponId), plan, myst, gnosis, style, slotCount, attrs));
            }
          }
        }
      }
    }
    found.sort((a, b) => b.score - a.score);
    const diverse = [];
    const seen = new Set();
    const perGun = {};
    const perDecay = {};
    for (const ev of found) {
      const core = coreOf(ev);
      if (seen.has(core)) continue;
      const gun = ev.loadout.primary ? ev.loadout.primary.id : "-";
      const decay = ev.math && ev.math.decay ? ev.math.decay.decay.item.id : "-";
      if ((perGun[gun] || 0) >= 2) continue;
      if ((perDecay[decay] || 0) >= 3) continue;
      seen.add(core);
      perGun[gun] = (perGun[gun] || 0) + 1;
      perDecay[decay] = (perDecay[decay] || 0) + 1;
      diverse.push(ev);
      if (diverse.length >= 12) break;
    }
    return diverse;
  }

  function orderGuns(a, b, style) {
    const weight = (g) => {
      let n = g.range === "long" ? 1 : 0;
      if (style === "corps") n -= 2;
      if (style === "distance") n += 3;
      if (g.applies && g.applies.decay) n += 6;
      if (g.applies && g.applies.burn) n += 3;
      if (g.applies && g.applies.shock) n += 2;
      if (g.applies && g.applies.freeze) n += 2;
      return n;
    };
    return weight(a) >= weight(b) ? [a, b] : [b, a];
  }

  function materialize(slots, gnosis) {
    const loadout = {};
    const missing = [];
    for (const key of ["primary", "secondary", "demonic", "melee", "light", "heavy", "relic", "fetish", "ring"]) {
      const entry = item(slots[key]);
      if (!entry) { loadout[key] = null; continue; }
      if (entry.gnosis > gnosis) missing.push(entry);
      else loadout[key] = entry;
    }
    return { loadout, missing };
  }

  function substitute(loadout, missing, plan, gnosis, myst, style) {
    const src = pool(gnosis);
    const notes = [];
    for (const gone of missing) {
      const bucket = gone.slot === "weapon" ? src.weapons
        : gone.slot === "demonic" ? src.demonic
        : gone.slot === "melee" ? src.melee
        : gone.slot === "light" ? src.lights
        : gone.slot === "heavy" ? src.heavies
        : gone.slot === "relic" ? src.relics
        : gone.slot === "ring" ? src.rings
        : src.fetishes;
      const ranked = rank(bucket, plan, myst, style, 6);
      const replacement = ranked.find((c) => !pieces(loadout).some((p) => p && p.id === c.id));
      if (!replacement) {
        notes.push(`${gone.name} demande le Gnosis ${gone.gnosis}. Rien d'équivalent n'est encore débloqué.`);
        continue;
      }
      if (gone.slot === "weapon") {
        if (!loadout.primary) loadout.primary = replacement;
        else if (!loadout.secondary) loadout.secondary = replacement;
        else notes.push(`${gone.name} reste hors de portée.`);
      } else loadout[gone.slot] = replacement;
      notes.push(`${gone.name} (Gnosis ${gone.gnosis}) est remplacé par ${replacement.name}, disponible au Gnosis ${replacement.gnosis}.`);
    }
    return notes;
  }

  function playSignature(ev) {
    return ["primary", "secondary", "light", "heavy", "ring"]
      .map((key) => (ev.loadout[key] ? ev.loadout[key].id : "-"))
      .join("|");
  }

  function coreOf(ev) {
    const decay = ev.math && ev.math.decay ? ev.math.decay.decay.item.id : "-";
    const burn = ev.math && ev.math.burn ? ev.math.burn.item.id : "-";
    const gun = ev.loadout.primary ? ev.loadout.primary.id : "-";
    return `${gun}|${decay}|${burn}`;
  }

  function signature(ev) {
    return ["primary", "secondary", "light", "heavy", "relic", "ring"]
      .map((key) => (ev.loadout[key] ? ev.loadout[key].id : "-"))
      .sort()
      .join("|");
  }

  function buildName(ev) {
    const gun = ev.loadout.primary ? ev.loadout.primary.name : "Mains nues";
    const decay = ev.math.decay ? ev.math.decay.decay.item.name : "";
    const burn = ev.math.burn ? ev.math.burn.item.name : "";
    const shock = ev.math.shock ? ev.math.shock.item.name : "";
    const freeze = ev.math.freeze ? ev.math.freeze.item.name : "";
    if (decay && burn) {
      const left = decay === gun ? gun : `${gun} · ${decay}`;
      const right = burn === gun || burn === decay ? "" : burn;
      return right ? `${left} × ${right}` : left;
    }
    if (burn && freeze) return burn === gun ? `${gun} et ${freeze}` : `${gun} · ${burn} et ${freeze}`;
    if (burn && shock) return burn === gun ? `${gun} × ${shock}` : `${gun} · ${burn} × ${shock}`;
    if (decay && shock) return `${gun} · ${decay} × ${shock}`;
    if (freeze) return `${gun} · gel de ${freeze}`;
    if (burn) return `${gun} · brûlure de ${burn}`;
    if (decay) return `${gun} · ${decay}`;
    return gun;
  }

  function ruleFor(plan) {
    const list = [...plan].sort().join(",");
    return DATA.rules.find((rule) => rule.pair.slice().sort().join(",") === list) || null;
  }

  function noteFor(ev, myst) {
    const math = ev.math;
    const bits = [];
    if ((math.kind === "burn-decay" || math.kind === "burn-decay-shock") && math.decay && math.burn) {
      const others = (math.decay.others || []).map((other) => other.decay.item.name);
      bits.push(`Le calcul retient ${math.decay.decay.item.name} pour la Putréfaction et ${math.burn.item.name} pour la Brûlure. Un tick de table passe de ${fmt(math.decay.row.tick)} à ${fmt(math.comboTick)} (${fmt(math.decay.row.tick)} × ${fmt(burnMultiplier(math.burn.base, math.burn.bead, math.mode), 3)} × 1,5).`);
      if (math.tickShock) bits.push(`Chaque tick renvoie un éclair de ${fmt(math.tickShock)}, puis ${fmt(math.tickShockSecond)} au second saut.`);
      if (others.length) bits.push(`Aussi dans l'équipement, sans additionner les ticks : ${others.join(", ")}.`);
      bits.push("L'arme peut ne faire qu'un point de dégât : le malus continue après le repli.");
    } else if (math.burn && math.shock) {
      bits.push(`Le choc de ${math.shock.item.name} porte la chaîne, la brûlure de ${math.burn.item.name} la multiplie. Premier rebond ${fmt(math.shockChain)}, second ${fmt(math.shockSecond)}. Le gros chiffre demande que le groupe brûle.`);
      if (math.freeze) bits.push(`Le tir garanti, brûlure et gel, vaut ${fmt(math.takenBurnFreeze)}. L'explosion du couple n'a pas de montant publié.`);
    } else if (math.burn && math.freeze) {
      bits.push(`Le couple utile est le gel de ${math.freeze.item.name} avec la brûlure de ${math.burn.item.name}. Le tir garanti vaut ${fmt(math.takenBurnFreeze)} : dégâts × magnitude de brûlure × 1,5. L'explosion du couple n'a pas de montant publié.`);
    } else if (math.decay && math.shock) {
      bits.push(math.tickShock
        ? `Chaque tick de ${math.decay.decay.item.name} renvoie un éclair de ${fmt(math.tickShock)} via ${math.shock.item.name}, puis ${fmt(math.tickShockSecond)} au second saut.`
        : `Chaque tick de ${math.decay.decay.item.name} peut renvoyer un éclair grâce au choc de ${math.shock.item.name}, sans magnitude chiffrée.`);
    } else if (math.decay && math.freeze && math.decay.row) {
      bits.push(`Le tick de ${math.decay.decay.item.name} passe de ${fmt(math.decay.row.tick)} à ${fmt(math.comboTick)} sur un gelé. La durée rallongée par le gel n'est pas chiffrée.`);
    } else if (math.freeze) {
      bits.push(`Le gel de ${math.freeze.item.name} porte le build : +50 % de dégâts subis, et les arcanes d'Eau (Freezing Gust, Shattered Soul) frappent au dégel.`);
    } else if (math.burn) {
      bits.push(`La brûlure de ${math.burn.item.name} est le malus central : les tirs et les arcanes de Feu (Pyrolysis, Critical Burn) ne servent que tant qu'elle tient.`);
    } else if (math.decay) {
      bits.push(`La putréfaction de ${math.decay.decay.item.name} inflige les dégâts dans la durée. Une source de Feu manque encore pour déclencher le ×1,5.`);
    } else {
      bits.push("Cet équipement gagne par les dégâts d'arme et le contrôle, sans combo élémentaire chiffré.");
    }
    bits.push(`Calcul au Mysterium ${myst}. Perles choisies : ${ev.beads.length ? ev.beads.map((b) => b.name).join(", ") : "aucune"}.`);
    return bits.join(" ");
  }

  function rotationFor(ev) {
    const steps = [];
    const ring = ev.loadout.ring;
    const heavy = ev.loadout.heavy;
    const light = ev.loadout.light;
    if (heavy && heavy.applies && (heavy.applies.burn || heavy.applies.decay || heavy.applies.freeze || heavy.applies.shock)) {
      steps.push(`Poser ${heavy.name} sur le groupe.`);
    }
    if (light) steps.push(`Lancer ${light.name} sur la cible prioritaire ou le groupe.`);
    if (ring && ring.applies && ring.applies.dash && ring.applies.burn) steps.push("Faire un dash, deux fois si Crown of Fire est au M3, pour enflammer l'arme.");
    else if (ring && ring.applies && ring.applies.dash) steps.push(`Faire un dash pour déclencher ${ring.name}.`);
    else if (ring && ring.applies && ring.applies.slide) steps.push(`Glisser pour déclencher ${ring.name}.`);
    if (ev.loadout.primary) steps.push(`Tirer avec ${ev.loadout.primary.name}, puis ${ev.loadout.secondary ? ev.loadout.secondary.name : "l'autre arme"} selon la distance.`);
    if (ev.loadout.melee) {
      const psycho = [ev.loadout.primary, ev.loadout.secondary].some((gun) => gun && gun.id === "psychopomp");
      steps.push(psycho
        ? `Mêlée ${ev.loadout.melee.name} : au M3 de Psychopomp un kill la recharge, au M1 un kill de coup chargé rend jusqu'à la moitié du chargeur.`
        : `Finir au corps avec ${ev.loadout.melee.name} quand la charge est pleine, surtout sur un étourdi.`);
    }
    if (ev.math.kind === "burn-decay" || ev.math.kind === "burn-decay-shock") steps.push("Se couvrir pendant que les ticks finissent les blessés.");
    return steps.join(" ");
  }

  function arcanaFor(elements, gnosis) {
    const lines = [];
    for (const el of elements) {
      const list = DATA.arcana[el];
      if (list) lines.push({ element: DATA.EL[el].name, picks: list.slice(0, 3) });
    }
    const prophecies = gnosis >= 4
      ? elements.map((el) => DATA.prophecies[el]).filter(Boolean)
      : [];
    return { lines, prophecies, locked: gnosis < 4 };
  }

  function firepowerText(loadout) {
    const bits = [];
    for (const gun of [loadout.primary, loadout.secondary].filter((gun) => gun && gun.stats && gun.stats.mag)) {
      bits.push(`${gun.name} : ${fmt(gun.stats.damage)} dégâts par balle, ${gun.stats.mag} balles, tir soutenu ${fmt(sustainedDps(gun))}`);
    }
    if (loadout.demonic && loadout.demonic.stats && loadout.demonic.stats.mag) {
      bits.push(`${loadout.demonic.name} compte à 40 % (${fmt(sustainedDps(loadout.demonic) * 0.4)}) : ses munitions ne tiennent pas le combat`);
    }
    if (!bits.length) return "";
    return `Le score ajoute le tir soutenu : dégâts par balle × balles du chargeur, divisés par le temps pour vider le chargeur puis le recharger. ${bits.join(". ")}.`;
  }

  function proof(ev, myst, gnosis, extra) {
    const phase = phaseOf(gnosis);
    const steps = [
      {
        title: "Contraintes",
        text: `Gnosis ${gnosis} (${phase.name}), ${rosarySlots(gnosis)} perle${rosarySlots(gnosis) > 1 ? "s" : ""} de rosaire, Mysterium ${myst} supposé. Deux armes standard, une démoniaque, une mêlée, un sort léger, un sort lourd, une relique, un fétiche, un anneau.`,
      },
    ];
    steps.push(...ev.math.lines);
    if (ev.beads.length) {
      steps.push({
        title: "Choix des perles",
        text: `Parmi les perles déjà accessibles, le moteur compare les combinaisons qui remplissent le rosaire. Il retient ${ev.beads.map((b) => `${b.name} (${b.summary})`).join(" ; ")}.`,
      });
    }
    const fireLine = firepowerText(ev.loadout);
    if (fireLine) steps.push({ title: "Tir soutenu", text: fireLine });
    if (ev.math.decay) {
      const up = uptimeOf(ev.math.decay.decay);
      if (up < 0.99) {
        steps.push({
          title: "Tenue en combat",
          text: `Le total publié reste celui du wiki. Le classement le pondère par ${fmt(up, 2)} : ${ev.math.decay.decay.item.name} demande de maintenir un sort, un essaim ou une zone, là où une rafale continue couvre le combat plus simplement.`,
        });
      }
    }
    if (extra && extra.length) steps.push({ title: "Substitutions", text: extra.join(" ") });
    const horizon = horizonText(ev, gnosis, myst);
    if (horizon) steps.push({ title: "Plus tard", text: horizon });
    return steps;
  }

  function horizonText(ev, gnosis, myst) {
    if (gnosis >= 4) return "";
    const later = [...DATA.weapons, ...DATA.spells, ...DATA.relics, ...DATA.rings].filter((entry) => entry.gnosis > gnosis && entry.gnosis <= gnosis + 2);
    const decayBetter = later.find((entry) => entry.id === "rotweaver" || entry.id === "stigma" || entry.id === "miasma");
    if (ev.plan.includes("earth") && decayBetter && !(ev.loadout.primary && ev.loadout.primary.id === decayBetter.id)) {
      return `${decayBetter.name} s'ouvre au Gnosis ${decayBetter.gnosis}. ${decayBetter.found}`;
    }
    const burnBetter = later.find((entry) => entry.id === "burning-stake" || entry.id === "crown-of-fire");
    if (ev.plan.includes("fire") && burnBetter) return `${burnBetter.name} s'ouvre au Gnosis ${burnBetter.gnosis}. ${burnBetter.found}`;
    return "";
  }

  function statsLine(entry) {
    if (!entry) return "";
    if (entry.slot === "melee" && entry.stats) {
      const s = entry.stats;
      const special = s.shockwave != null ? `${s.special} ou onde ${s.shockwave}` : s.special;
      let stun = s.stunnedCharged ? ` · chargé étourdi ${s.stunnedCharged}` : "";
      if (s.stunnedShockwave) stun += ` · onde étourdie ${s.stunnedShockwave}`;
      return `Simple ${s.damage} · chargé ${s.charged} · spécial ${special}${stun}`;
    }
    if (entry.stats) {
      const s = entry.stats;
      return `${s.damage} dégâts · crit ${Math.round(s.crit * 100)} % · ${s.rof} tirs/s · ${s.ads} m visée · chargeur ${s.mag} · réserve ${s.reserve} · rechargement ${s.reload} s`;
    }
    if (entry.recharge != null) return `Recharge ${entry.recharge} · ${entry.summary}`;
    return entry.summary || "";
  }

  const CROWD_SPELLS = {
    fireballs: true, firebreath: true, "frost-cone": true, stormball: true, shockwave: true,
    miasma: true, "rotten-fiend": true, "ice-sphere": true, "burning-stake": true,
    cornucopia: true, "cursed-bell": true, "falling-star": true,
  };

  function inferPlayTags(ev) {
    const loadout = ev.loadout || {};
    const math = ev.math || {};
    const guns = [loadout.primary, loadout.secondary].filter(Boolean);
    const long = guns.some((gun) => gun.range === "long");
    const close = guns.some((gun) => gun.range === "close");
    const sniper = guns.some((gun) => gun.stats && gun.stats.unwieldy === "sniper");
    const elemental = !!(math.package || math.comboTotal || math.shockChain || math.shockFirst || math.takenBurn || math.takenFreeze);
    const crowd = !!(math.burn && math.burn.aoe)
      || [loadout.light, loadout.heavy, loadout.demonic].some((entry) => entry && CROWD_SPELLS[entry.id]);
    const primary = loadout.primary;
    const rangeTag = primary && primary.range === "close" ? "corps" : primary && primary.range === "long" ? "distance" : close ? "corps" : long ? "distance" : "";
    const otherRange = rangeTag === "corps" && long ? "distance" : rangeTag === "distance" && close ? "corps" : "";
    const candidates = [];
    if (elemental) candidates.push("elementaire");
    if (crowd) candidates.push("foules");
    if (math.decay && (primary && primary.range === "long" || !crowd)) candidates.push("boss");
    if (rangeTag) candidates.push(rangeTag);
    if (otherRange) candidates.push(otherRange);
    if (sniper) candidates.push("survie");
    if (guns.length && !elemental) candidates.push("tir");
    const tags = [];
    for (const tag of candidates) {
      if (tags.length >= 3) break;
      if (!tags.includes(tag)) tags.push(tag);
    }
    if (tags.length < 2 && guns.length && !elemental && !tags.includes("tir")) tags.push("tir");
    if (!tags.length) tags.push("elementaire");
    return tags;
  }

  function tagsFor(ev, meta) {
    const cited = (meta && meta.tags) || [];
    const play = cited.filter((tag) => tag !== "fin" && tag !== "personnel");
    if (play.length >= 2) return cited;
    const tags = cited.slice();
    for (const tag of inferPlayTags(ev)) {
      if (!tags.includes(tag)) tags.push(tag);
    }
    return tags;
  }

  function toCard(ev, gnosis, myst, meta) {
    const phase = phaseOf(Math.max(gnosis, meta && meta.gnosis || 0));
    const elements = ev.math.elements.map((id) => DATA.EL[id]);
    return {
      id: (meta && meta.id) || signature(ev),
      name: (meta && meta.subs && meta.subs.length ? `${meta.name} (adapté)` : (meta && meta.name)) || buildName(ev),
      blurb: (meta && meta.blurb) || noteFor(ev, myst),
      note: noteFor(ev, myst),
      rotation: (meta && meta.rotation) || rotationFor(ev),
      phase: phase.name,
      phaseId: phase.id,
      gnosis,
      mysterium: myst,
      score: Math.round(ev.score),
      tags: tagsFor(ev, meta),
      elements,
      plan: ev.plan,
      loadout: ev.loadout,
      beads: ev.beads,
      math: {
        comboTick: ev.math.comboTick,
        comboTotal: ev.math.comboTotal,
        package: ev.math.package,
        shockChain: ev.math.shockChain,
        shockSecond: ev.math.shockSecond,
        shockFirst: ev.math.shockFirst,
        tickShock: ev.math.tickShock,
        tickShockSecond: ev.math.tickShockSecond,
        tickShockTotal: ev.math.tickShockTotal,
        tickShockSecondTotal: ev.math.tickShockSecondTotal,
        takenBurn: ev.math.takenBurn,
        takenFreeze: ev.math.takenFreeze,
        takenBurnFreeze: ev.math.takenBurnFreeze,
        kind: ev.math.kind,
        lines: ev.math.lines,
      },
      proof: proof(ev, myst, gnosis, meta && meta.subs),
      arcana: arcanaFor(ev.math.elements, gnosis),
      sources: (meta && meta.sources) || DATA.sources.slice(0, 2),
      statsLine,
      community: !!(meta && meta.community),
      cited: !meta || meta.cited !== false,
      hintCovered: !meta || meta.hintCovered !== false,
      hintGap: (meta && meta.hintGap) || "",
    };
  }

  const PLAY_STYLES = ["elementaire", "foules", "boss", "distance", "corps", "survie", "tir"];

  function shownForStyle(pinned, style) {
    const tags = pinned.tags || [];
    if (style === "populaire") return Array.isArray(pinned.sources) && pinned.sources.length > 0;
    if (style === "notable") return tags.includes("notable");
    if (tags.includes("notable") && !tags.some((tag) => PLAY_STYLES.includes(tag))) return false;
    return true;
  }

  function styleRank(ev, style) {
    const tags = (ev.meta && ev.meta.tags) || [];
    if (tags.includes(style)) return 2;
    if (style === "survie") {
      const guns = [ev.loadout.primary, ev.loadout.secondary].filter(Boolean);
      if (guns.filter((g) => g.stats && g.stats.unwieldy === "sniper").length >= 2) return 2;
    }
    return 0;
  }

  function recommendAll(query) {
    const merged = [];
    const seen = new Map();
    const locked = [];
    const lockedSeen = new Set();
    let hiddenHints = 0;
    let sample = null;
    const passes = [["elementaire", false]];
    for (const style of PLAY_STYLES) {
      if (style !== "elementaire") passes.push([style, true]);
    }
    passes.push(["notable", true]);
    for (const [style, communityOnly] of passes) {
      const part = recommend(Object.assign({}, query, { style, communityOnly }));
      sample = sample || part;
      hiddenHints += part.hiddenHints || 0;
      for (const card of part.builds) {
        const prev = seen.get(card.id);
        if (prev) {
          if (card.score > prev.score) prev.score = card.score;
          continue;
        }
        seen.set(card.id, card);
        merged.push(card);
      }
      for (const card of part.locked || []) {
        if (lockedSeen.has(card.id)) continue;
        lockedSeen.add(card.id);
        locked.push(card);
      }
    }
    merged.sort((a, b) => b.score - a.score);
    return Object.assign({}, sample, { builds: merged, locked, hiddenHints });
  }

  function recommend(query) {
    if ((query.style || "elementaire") === "toutes") return recommendAll(query);
    const gnosis = clamp(query.gnosis, 0, 7);
    const myst = assumedMysterium(gnosis, query.mysterium);
    const style = query.style || "elementaire";
    const elements = query.elements || [];
    const weaponId = query.weapon || "";
    const slotCount = rosarySlots(gnosis);
    const attrs = query.attrs || null;
    const plans = plansFor(elements);
    const bag = [];
    if (style !== "notable" && style !== "populaire" && !query.communityOnly) {
      for (const plan of plans) {
        bag.push(...searchPlan(plan, gnosis, myst, style, slotCount, weaponId, attrs));
      }
    }
    const hintMeta = (pinned, extra) => {
      const need = combinedHint(pinned.beadHint);
      const fits = attrsCover(need, attrs);
      return Object.assign({}, pinned, extra, {
        hintCovered: fits,
        hintGap: fits || !attrs ? "" : hintGapText(need, attrs),
      });
    };
    let hiddenHints = 0;
    for (const pinned of DATA.community) {
      if (!shownForStyle(pinned, style)) continue;
      if (elements.length && !pinnedCovers(pinned, elements, myst, gnosis)) continue;
      if (weaponId && !Object.values(pinned.slots).includes(weaponId) && !DATA.melee.some((entry) => entry.id === weaponId)) continue;
      const plan = planFromPinned(pinned, myst);
      const { loadout, missing } = materialize(pinned.slots, gnosis);
      if (!loadout.melee) attachMelee(loadout, pool(gnosis).melee, style, weaponId);
      const fidelity = 1 - missing.length / Object.keys(pinned.slots).length;
      if (missing.length && fidelity < 0.7) continue;
      if (missing.length && !query.showLocked) {
        const subs = substitute(loadout, missing, plan, gnosis, myst, style);
        if (!loadout.primary && !loadout.light) continue;
        const ev = evaluate(loadout, plan, myst, gnosis, style, slotCount, attrs);
        ev.score += 15;
        bag.push(Object.assign(ev, { meta: hintMeta(pinned, { subs, community: true }) }));
      } else if (!missing.length) {
        const ev = evaluate(loadout, plan, myst, gnosis, style, slotCount, attrs);
        ev.score += 25;
        bag.push(Object.assign(ev, { meta: hintMeta(pinned, { community: true }) }));
      }
    }
    if (query.onlyCovered) {
      const seen = new Set();
      const next = [];
      for (const ev of bag) {
        if (ev.meta && ev.meta.community && ev.meta.hintCovered === false) {
          if (!seen.has(ev.meta.id)) {
            seen.add(ev.meta.id);
            hiddenHints += 1;
          }
          continue;
        }
        next.push(ev);
      }
      bag.splice(0, bag.length, ...next);
    }
    bag.sort((a, b) => {
      const gap = styleRank(b, style) - styleRank(a, style);
      if (gap) return gap;
      return b.score - a.score;
    });
    const used = new Set();
    const cores = new Set();
    const decayUses = {};
    const cards = [];
    const take = (ev) => {
      const key = playSignature(ev);
      const core = coreOf(ev);
      const decayId = ev.math && ev.math.decay ? ev.math.decay.decay.item.id : "-";
      const faithful = ev.meta && ev.meta.community && !(ev.meta.subs && ev.meta.subs.length);
      if (used.has(key) || cores.has(core)) return;
      const cited = !!(ev.meta && ev.meta.community);
      if (!faithful && !cited && decayUses[decayId] >= 4) return;
      if (weaponId && !pieces(ev.loadout).some((p) => p && p.id === weaponId)) return;
      used.add(key);
      cores.add(core);
      if (!cited) decayUses[decayId] = (decayUses[decayId] || 0) + 1;
      cards.push(toCard(ev, gnosis, myst, ev.meta));
    };
    const generatedCap = style === "notable" || style === "populaire" ? 0 : 36;
    for (const ev of bag.filter((entry) => entry.meta && entry.meta.community)) take(ev);
    const byScore = bag.slice().sort((a, b) => b.score - a.score);
    let generated = 0;
    for (const ev of byScore) {
      if (ev.meta && ev.meta.community) continue;
      const before = cards.length;
      take(ev);
      if (cards.length > before) generated += 1;
      if (generated >= generatedCap) break;
    }
    for (const ev of bag.filter((entry) => entry.meta && entry.meta.anchor)) {
      if (cards.some((card) => card.id === ev.meta.id)) continue;
      const card = toCard(ev, gnosis, myst, ev.meta);
      if (styleRank(ev, style) > 0 && style !== "elementaire") cards.unshift(card);
      else cards.push(card);
    }
    const locked = [];
    if (query.showLocked) {
      for (const pinned of DATA.community) {
        if (!shownForStyle(pinned, style)) continue;
        if (pinned.gnosis <= gnosis) continue;
        if (weaponId && !Object.values(pinned.slots).includes(weaponId) && !DATA.melee.some((entry) => entry.id === weaponId)) continue;
        const plan = planFromPinned(pinned, 3);
        const loadout = {};
        for (const key of Object.keys(pinned.slots)) loadout[key] = item(pinned.slots[key]);
        if (!loadout.melee) attachMelee(loadout, pool(pinned.gnosis).melee, style, weaponId);
        const ev = evaluate(loadout, plan, 3, pinned.gnosis, style, rosarySlots(pinned.gnosis), attrs);
        const card = toCard(ev, pinned.gnosis, 3, hintMeta(pinned, { community: true }));
        card.locked = true;
        card.blurb = `Aperçu, pas encore jouable : il faut le Gnosis ${pinned.gnosis}. ` + card.blurb;
        locked.push(card);
      }
    }
    if (query.onlyCovered) {
      const stillLocked = [];
      for (const card of locked) {
        if (card.hintCovered === false) hiddenHints += 1;
        else stillLocked.push(card);
      }
      locked.length = 0;
      for (const card of stillLocked) locked.push(card);
    }
    return {
      gnosis,
      phase: phaseOf(gnosis),
      mysterium: myst,
      slots: slotCount,
      builds: cards,
      locked,
      hiddenHints,
    };
  }

  function pinnedCovers(pinned, elements, myst, gnosis) {
    const names = Object.values(pinned.slots).map(item).filter(Boolean);
    const have = new Set();
    for (const entry of names) {
      for (const el of entry.elements || []) have.add(el);
      if (burnOf(entry, 3)) have.add("fire");
      if (decayOf(entry, 3)) have.add("earth");
      if (shockOf(entry, 3)) have.add("air");
      if (freezeOf(entry, 3)) have.add("water");
    }
    return elements.every((el) => have.has(el));
  }

  function planFromPinned(pinned, myst) {
    const set = new Set();
    for (const id of Object.values(pinned.slots)) {
      const entry = item(id);
      if (!entry) continue;
      if (burnOf(entry, myst) || burnOf(entry, 3)) set.add("fire");
      if (decayOf(entry, myst) || decayOf(entry, 3)) set.add("earth");
      if (shockOf(entry, myst) || shockOf(entry, 3)) set.add("air");
      if (freezeOf(entry, myst) || freezeOf(entry, 3)) set.add("water");
    }
    if (!set.size) set.add("fire");
    return set;
  }

  function explainLab(decayId, burnId, mode, shot, shockId) {
    const decayItem = item(decayId);
    const burnItem = item(burnId);
    const shockItem = item(shockId);
    const beads = [];
    if (mode === "power" || mode === "both") beads.push(item("ailment-power"));
    if (mode === "acute" || mode === "both") beads.push(item("acute-ailment"));
    const loadout = { primary: null, secondary: null, demonic: null, light: null, heavy: null, relic: null, fetish: null, ring: null };
    const keys = ["primary", "secondary", "light", "heavy", "relic", "ring", "demonic"];
    for (const entry of [decayItem, burnItem, shockItem]) {
      if (!entry) continue;
      const preferred = entry.slot === "weapon" ? "primary" : entry.slot;
      const order = [preferred].concat(keys.filter((key) => key !== preferred));
      for (const key of order) {
        if (!loadout[key]) { loadout[key] = entry; break; }
      }
    }
    return computeMath(loadout, beads.filter(Boolean), 3, shot);
  }

  function catalog() {
    return {
      weapons: DATA.weapons.concat(DATA.demonic.filter((d) => d.slot === "weapon")),
      demonic: DATA.demonic.filter((d) => d.demonic),
      melee: DATA.melee,
      spells: DATA.spells,
      relics: DATA.relics,
      rings: DATA.rings,
      fetishes: DATA.fetishes,
      beads: DATA.beads,
      rules: DATA.rules,
      sources: DATA.sources,
    };
  }

  function clamp(n, a, b) {
    n = Number(n);
    if (Number.isNaN(n)) return a;
    return Math.max(a, Math.min(b, n));
  }

  function fmt(n, digits) {
    const d = digits == null ? 1 : digits;
    const rounded = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return String(rounded).replace(".", ",");
  }

  function pct(n) {
    return `${fmt(n * 100, 1)} %`;
  }

  const ATTRS = [
    { id: "flesh", name: "Chair" },
    { id: "blood", name: "Sang" },
    { id: "mind", name: "Esprit" },
    { id: "witchery", name: "Sorcellerie" },
    { id: "arsenal", name: "Arsenal" },
    { id: "faith", name: "Foi" },
  ];

  const DERIVED = [
    { id: "health", name: "Santé", min: 85, max: 160, unit: " PV", mix: [["flesh", 100]] },
    { id: "resist", name: "Résistance élémentaire", min: 0, max: 25, unit: " %", mix: [["flesh", 90], ["witchery", 10]] },
    { id: "melee", name: "Recharge de mêlée", min: 80, max: 175, unit: " %", mix: [["flesh", 80], ["blood", 20]] },
    { id: "stamina", name: "Endurance", min: 90, max: 150, unit: " PE", mix: [["blood", 90], ["arsenal", 10]] },
    { id: "mobility", name: "Mobilité", min: 100, max: 200, unit: " %", mix: [["blood", 100]] },
    { id: "vigor", name: "Vigueur", min: 0, max: 50, unit: " %", mix: [["blood", 70], ["flesh", 20], ["arsenal", 10]] },
    { id: "scavenge", name: "Butin", min: 0, max: 60, unit: " %", mix: [["mind", 100]] },
    { id: "healing", name: "Soins", min: 70, max: 130, unit: " %", mix: [["mind", 90], ["faith", 10]] },
    { id: "madness", name: "Résistance à la folie", min: 0, max: 25, unit: " %", mix: [["mind", 80], ["witchery", 20]] },
    { id: "spells", name: "Recharge des sorts", min: 75, max: 160, unit: " %", mix: [["witchery", 80], ["faith", 20]] },
    { id: "duration", name: "Durée élémentaire", min: 100, max: 150, unit: " %", mix: [["witchery", 100]] },
    { id: "metanoia", name: "Métanoïa", min: 0, max: 100, unit: " %", mix: [["witchery", 100]] },
    { id: "handling", name: "Maniement", min: 100, max: 200, unit: " %", mix: [["arsenal", 80], ["blood", 20]] },
    { id: "ammo", name: "Réserves", min: 0, max: 100, unit: " %", mix: [["arsenal", 80], ["mind", 20]] },
    { id: "range", name: "Portée", min: 0, max: 100, unit: " %", mix: [["arsenal", 100]] },
    { id: "providence", name: "Providence", min: 0, max: 100, unit: " %", mix: [["faith", 80], ["mind", 20]] },
    { id: "divine", name: "Intervention divine", min: 0, max: 100, unit: " %", mix: [["faith", 80], ["flesh", 20]] },
    { id: "blessed", name: "Visée bénie", min: 0, max: 100, unit: "", mix: [["faith", 90], ["arsenal", 10]] },
  ];

  function deriveAttributes(points) {
    const src = points || {};
    const t = (key) => clamp(src[key], 0, 100) / 100;
    return DERIVED.map((row) => {
      let acc = 0;
      let weight = 0;
      for (const part of row.mix) {
        acc += t(part[0]) * part[1];
        weight += part[1];
      }
      const value = row.min + (row.max - row.min) * (weight ? acc / weight : 0);
      return { id: row.id, name: row.name, value, text: `${fmt(value, 0)}${row.unit}` };
    });
  }

  function simulate(loadout, beads, myst, points, opts) {
    const options = opts || {};
    const stats = deriveAttributes(points);
    const math = computeMath(loadout, beads || [], myst);
    const prefer = ["primary", "secondary", "demonic", "melee"];
    const gunKey = options.gun && loadout[options.gun] && loadout[options.gun].stats
      ? options.gun
      : prefer.find((key) => loadout[key] && loadout[key].stats) || null;
    const gun = gunKey ? loadout[gunKey] : null;
    const notes = [
      "Les stats secondaires relient le minimum et le maximum du fil « Stats Explained », selon les poids de ce fil. Le wiki ne publie pas la courbe du sanctuaire point par point.",
      "La visée bénie n'est pas convertie en chance de critique. La part de tirs critiques est un réglage du simulateur.",
      "Les totaux de ticks du wiki incluent déjà +50 % de durée. La durée élémentaire de la transcendance n'est pas réappliquée.",
    ];
    if (!gun) return { stats, math, gun: null, gunKey: null, rows: [], notes, sheet: null };
    if (gun.slot === "melee") {
      const blow = gun.stats;
      const row = (name, hit) => ({ name, hit, crit: hit, avg: hit, dps: null });
      const rows = [row("Coup simple", blow.damage), row("Coup chargé", blow.charged), row(blow.shockwave != null ? "Taille" : "Attaque spéciale", blow.special)];
      if (blow.shockwave != null) rows.push(row("Onde de feu", blow.shockwave));
      if (blow.stunnedCharged) rows.push(row("Chargé sur étourdi", blow.stunnedCharged));
      if (blow.stunnedSpecial) rows.push(row("Spécial sur étourdi", blow.stunnedSpecial));
      if (blow.stunnedShockwave) rows.push(row("Onde de feu sur étourdi", blow.stunnedShockwave));
      notes.push("La mêlée n'a pas de cadence publiée. Le coup chargé et l'attaque spéciale demandent la charge. La ligne étourdi est déjà le chiffre du wiki, sans ×2 supplémentaire.");
      return {
        stats, math, gun, gunKey, rows, notes, melee: true, burnMult: 1,
        sheet: { damage: blow.charged, crit: 1, ads: blow.reach || 0, reserve: 0 },
      };
    }
    const ammo = stats.find((row) => row.id === "ammo").value;
    const range = stats.find((row) => row.id === "range").value;
    const sheet = {
      damage: gun.stats.damage,
      crit: gun.stats.crit,
      rof: gun.stats.rof || 0,
      reload: gun.stats.reload || 0,
      mag: gun.stats.mag || 1,
      reserve: gun.stats.reserve * (100 + ammo) / 100,
      ads: (gun.stats.ads || 0) * (100 + range) / 100,
    };
    const burnMult = math.burn ? burnMultiplier(math.burn.base, math.burn.bead, math.mode) : 1;
    const rate = clamp(options.critRate || 0, 0, 1);
    const situations = [
      { name: "Fiche", taken: 1 },
      { name: "Cible gelée", taken: 1.5 },
      { name: "Étourdissement dur", taken: 2 },
      { name: "Gel et étourdissement", taken: 3 },
    ];
    if (math.burn) {
      situations.push({ name: `Brûlure de ${math.burn.item.name}`, taken: burnMult });
      situations.push({ name: "Brûlure et gel", taken: burnMult * 1.5 });
    }
    const rows = situations.map((situation) => {
      const hit = sheet.damage * situation.taken;
      const crit = hit * sheet.crit;
      const avg = hit * (1 - rate) + crit * rate;
      const cycle = sheet.rof > 0 ? sheet.mag / sheet.rof + sheet.reload : 0;
      const dps = cycle > 0 ? (sheet.mag * avg) / cycle : 0;
      return { name: situation.name, hit, crit, avg, dps };
    });
    const shotMath = computeMath(loadout, beads || [], myst, sheet.damage);
    const extra = (name, hit) => rows.push({ name, hit, crit: null, avg: null, dps: null });
    if (shotMath.shockChain) {
      extra("Brûlure + choc, premier rebond", shotMath.shockChain);
      extra("Brûlure + choc, second rebond", shotMath.shockSecond);
    } else if (shotMath.shockFirst) {
      extra("Choc, premier rebond", shotMath.shockFirst);
      extra("Choc, second rebond", shotMath.shockSecond);
    }
    if (shotMath.comboTick) extra("Tick de putréfaction", shotMath.comboTick);
    if (shotMath.tickShock) {
      extra("Éclair du tick", shotMath.tickShock);
      extra("Éclair secondaire du tick", shotMath.tickShockSecond);
    }
    return { stats, math: shotMath, gun, gunKey, rows, notes, sheet, burnMult };
  }

  function present(query) {
    const gnosis = clamp(query.gnosis, 0, 7);
    const myst = assumedMysterium(gnosis, query.mysterium);
    const loadout = { primary: null, secondary: null, demonic: null, melee: null, light: null, heavy: null, relic: null, fetish: null, ring: null };
    for (const key of Object.keys(loadout)) loadout[key] = item(query.slots && query.slots[key]) || null;
    const chosen = (query.beads || []).map(item).filter(Boolean);
    let ev;
    if (query.ownBeads) {
      const math = computeMath(loadout, chosen, myst);
      ev = { loadout, beads: chosen, math, score: math.package || math.comboTotal || 0, plan: math.elements, safety: 0 };
    } else if (chosen.length) {
      const math = computeMath(loadout, chosen, myst);
      ev = { loadout, beads: chosen, math, score: math.package || math.comboTotal || 0, plan: math.elements, safety: 0 };
    } else {
      const presentEls = activeElements(loadout, myst);
      const plan = presentEls.size ? presentEls : new Set(["fire", "earth"]);
      ev = evaluate(loadout, plan, myst, gnosis, query.style || "elementaire", rosarySlots(gnosis));
    }
    const card = toCard(ev, gnosis, myst, {
      id: query.id || signature(ev),
      name: query.name || "Équipement personnel",
      blurb: query.blurb || "Équipement composé dans l'atelier.",
      tags: ["personnel"],
      sources: [],
      cited: false,
    });
    card.custom = !!query.custom;
    card.attrs = query.attrs || null;
    card.critRate = query.critRate || 0;
    card.gun = query.gun || "primary";
    card.sourceId = query.sourceId || "";
    return card;
  }

  function selfCheck() {
    const late = recommend({ gnosis: 5, elements: ["fire", "earth"], mysterium: 3, style: "elementaire" });
    const early = recommend({ gnosis: 0, mysterium: "auto", style: "elementaire" });
    const rot = late.builds.find((b) => b.loadout.primary && (b.loadout.primary.id === "rotweaver" || (b.loadout.secondary && b.loadout.secondary.id === "rotweaver")) || pieces(b.loadout).some((p) => p && p.id === "rotweaver"));
    const earlyHasRot = early.builds.some((b) => pieces(b.loadout).some((p) => p && p.id === "rotweaver"));
    const beads = [item("ailment-power"), item("acute-ailment")];
    const math = computeMath({
      primary: item("rotweaver"), secondary: item("striga"), demonic: null,
      light: null, heavy: item("burning-stake"), relic: null, fetish: null, ring: item("crown-of-fire"),
    }, beads, 3);
    const tick = math.decay && math.decay.row ? math.decay.row.tick * burnMultiplier(0.375, true, "both") * 1.5 : 0;
    return {
      lateCount: late.builds.length,
      earlyCount: early.builds.length,
      foundRot: !!rot,
      earlyHasRot,
      tick: math.comboTick,
      burnBaseUsed: math.burn && math.burn.item.name,
      expectedStake: tick,
      unranked: unrankedItems(),
    };
  }

  root.WF = {
    recommend, explainLab, catalog, item, rosarySlots, phaseOf, assumedMysterium, computeMath, selfCheck, fmt, statsLine,
    deriveAttributes, simulate, present, attributes: ATTRS,
  };
})(typeof window !== "undefined" ? window : globalThis);
