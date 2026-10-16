/* Small editor views, separate from draft and upload state. */
(function (root) {
  root.TeresaAdminView = function ({ Schema, ROLE_LABELS, escapeHTML }) {
  function memberRow(member = {}, options = {}) {
    const data = Schema.normalizeMember(member, { scope: options.scope || "member", index: options.index || 0 });
    return `<div class="team-member-editor" data-member-id="${escapeHTML(data.id)}">
      <input class="team-member-name" value="${escapeHTML(data.name)}" placeholder="Tên thành viên" aria-label="Tên thành viên" />
      <input class="team-member-note" value="${escapeHTML(data.note || "")}" placeholder="Ghi chú (tùy chọn)" aria-label="Ghi chú thành viên" />
      <button class="danger-link" type="button" data-remove-member aria-label="Xóa thành viên">×</button>
    </div>`;
  }

  function roleEditor(key, role = {}) {
    const members = Array.isArray(role.members) ? role.members : [];
    return `<article class="team-row leadership-role-editor" data-role-key="${escapeHTML(key)}">
      <div class="teams-heading"><strong>${escapeHTML(ROLE_LABELS[key] || key)}</strong><button class="text-button" type="button" data-add-role-member="${escapeHTML(key)}">+ Thêm người</button></div>
      <div class="team-members-list">${members.map((member, index) => memberRow(member, { scope: key, index })).join("") || '<p class="empty-note">Chưa có người phụ trách.</p>'}</div>
    </article>`;
  }

  function teamEditor(team = {}, index = 0) {
    return `<article class="team-row" data-team-id="${escapeHTML(team.id || "")}">
      <label>Tên ban<input class="team-name" value="${escapeHTML(team.name || "")}" placeholder="Ví dụ: Ban Truyền thông" required /></label>
      <div class="team-members-editor"><div class="team-members-list">${(team.members || []).map((member, memberIndex) => memberRow(member, { scope: team.name || `team-${index}`, index: memberIndex })).join("") || '<p class="empty-note">Chưa có thành viên.</p>'}</div><button class="text-button" type="button" data-add-team-member>+ Thêm thành viên</button></div>
      <button class="danger-link" type="button" data-remove-team>Xóa ban</button>
    </article>`;
  }

  function coverFocusFields(value = {}, image = "") {
    const f = window.TeresaPublic.focus(value);
    return `<fieldset class="cover-focus"><legend>Căn khung ảnh bìa</legend><p>Di chuyển để giữ đúng người hoặc chi tiết quan trọng trong khung. Dùng lại ảnh hiện có.</p>${[["Máy tính", "x", "y", "desktop"],["Điện thoại", "mobileX", "mobileY", "phone"]].map(([title,x,y,device]) => `<div class="cover-focus-device" data-focus-device="${device}"><strong>${title}</strong><img src="${escapeHTML(image || "images/optimized/hero-768.webp")}" alt="Khung ảnh ${title}" style="object-position:${f[x]}% ${f[y]}%" /><label>Trái – phải<input type="range" name="focus_${x}" min="0" max="100" value="${f[x]}" /></label><label>Trên – dưới<input type="range" name="focus_${y}" min="0" max="100" value="${f[y]}" /></label></div>`).join("")}</fieldset>`;
  }
  function collectCoverFocus(values) {
    return window.TeresaPublic.focus({x:values.focus_x,y:values.focus_y,mobileX:values.focus_mobileX,mobileY:values.focus_mobileY});
  }


    return {memberRow,roleEditor,teamEditor,coverFocusFields,collectCoverFocus};
  };
})(window);
