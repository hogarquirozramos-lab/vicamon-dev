function buildTeamPickGrid() { 
  // Combinar Bestiario General con Vicamons Poseídos
  const allKeys = Object.entries(BEASTS).filter(([k,b]) => b.cat !== 'Físico' || (myPhysicalBeasts || []).includes(k));
  let html = '<div style="grid-column:1/-1; margin-bottom:5px; border-bottom:0.5px solid rgba(255,255,255,.2); padding-bottom:5px; color:#5DCAA5; font-weight:600; text-transform:uppercase; letter-spacing:.08em; font-size:12px">Bestiario General</div>';
  allKeys.forEach(([k,b]) => {
    html += `<div class="bcard" id="tpc-${k}" onclick="toggleTeamBeast('${k}')"><img src="${b.img}"><div class="bname">${b.name}</div><div class="bsub">${b.sub}</div><span class="bstyle" style="${STCSS[b.style]}">${b.style}</span><div class="elbar" style="background:${EL[b.el]}"></div></div>`;
  });
  
  // NUEVO: Sección de Mis Vicamons
  if (window.myOwnedVicamons && window.myOwnedVicamons.length > 0) {
    html += '<div style="grid-column:1/-1; margin-top:15px; margin-bottom:5px; border-bottom:0.5px solid rgba(246,226,102,.2); padding-bottom:5px; color:#F6E265; font-weight:600; text-transform:uppercase; letter-spacing:.08em; font-size:12px">Mis Vicamons (Entrenados)</div>';
    window.myOwnedVicamons.forEach(v => {
      const b = BEASTS[v.beast_key];
      if(!b) return;
      const k = `own_${v.id}`; // ID único temporal para el frontend
      // NUEVO: Guardamos una referencia global temporal para el combate
      window._tempOwnedBeasts = window._tempOwnedBeasts || {};
      window._tempOwnedBeasts[k] = { ...b, name: v.custom_name, stats: { atk: b.stats.atk + v.atk, def: b.stats.def + v.def, spd: b.stats.spd + v.spd } };
      
      html += `<div class="bcard" id="tpc-${k}" onclick="toggleTeamBeast('${k}')" style="border-color:rgba(246,226,102,.3)">
        <img src="${b.img}">
        <div class="bname" style="color:#F6E265">${v.custom_name}</div>
        <div class="bsub">${b.name} (Nivel ${v.level})</div>
        <span class="bstyle" style="${STCSS[b.style]}">${b.style}</span>
        <div class="elbar" style="background:${EL[b.el]}"></div>
      </div>`;
    });
  }
  
  html += `<div class="beast-detail" id="team-detail-panel"></div>`;
  document.getElementById('team-pick-grid').innerHTML = html;
  updateTeamSelectionUI();
}
