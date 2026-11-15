(() => {
  const select = document.querySelector('#model'), grid = document.querySelector('main');
  const status = document.querySelector('#status'), more = document.querySelector('#more');
  const initial = new URLSearchParams(location.search).get('model') || '';
  let offset = 0, loading = false, initialized = false;
  const labels = { approved: '已核對參考圖', pending: '待複核：僅供人工比對', quarantined: '隔離：型號或近似群有疑點', excluded: '已排除：不作辨識依據' };
  async function load(reset = false) {
    if (loading) return;
    loading = true; more.disabled = true;
    if (reset) { offset = 0; grid.replaceChildren(); }
    try {
      const response = await fetch(`/api/cpu/library?model=${encodeURIComponent(initialized ? select.value : initial)}&offset=${offset}`);
      if (!response.ok) throw Error('私人圖片庫限本機使用。請在執行 AI 的電腦以 localhost 開啟。');
      const data = await response.json();
      if (select.options.length === 1) {
        for (const model of data.models) { const option = document.createElement('option'); option.value = option.textContent = model; select.append(option); }
        select.value = initial;
        initialized = true;
      }
      for (const row of data.images) {
        const figure = document.createElement('figure'), image = document.createElement('img'), caption = document.createElement('figcaption'), review = document.createElement('strong');
        image.src = row.thumbnailUrl; image.alt = row.relative; image.loading = 'lazy'; image.tabIndex = 0;
        const zoom = () => { const dialog = document.createElement('dialog'), full = document.createElement('img'), close = document.createElement('button'); full.src = row.referenceUrl; full.alt = row.relative; close.textContent = '關閉'; close.onclick = () => dialog.close(); dialog.append(full, close); dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal(); };
        image.onclick = zoom; image.onkeydown = event => { if (event.key === 'Enter') zoom(); };
        review.textContent = labels[row.review.status] || labels.pending; review.className = row.review.status;
        caption.textContent = row.relative; caption.append(review);
        if (row.review.reason) { const reason = document.createElement('p'); reason.textContent = row.review.reason; caption.append(reason); }
        figure.append(image, caption); grid.append(figure);
      }
      offset += data.images.length; status.textContent = `已顯示 ${offset} / ${data.total} 張${data.excluded ? ` · 已排除 ${data.excluded} 張不可用圖片` : ''}`; more.hidden = offset >= data.total;
    } catch (error) { status.textContent = error.message; more.hidden = true; }
    finally { loading = false; more.disabled = false; }
  }
  document.querySelector('#load').onclick = () => load(true);
  select.onchange = () => { history.replaceState(null, '', '/cpu-library.html' + (select.value ? '?model=' + encodeURIComponent(select.value) : '')); load(true); };
  more.onclick = () => load();
  load(true);
})();
