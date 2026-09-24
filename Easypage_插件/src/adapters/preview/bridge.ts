// 预览桥接脚本（契约 01 §5 / T115）。
// 随 srcdoc 注入，与用户内容同文档；监听父页 postMessage('ep:extract')，
// 回传 {type:'ep:extracted', html}。因预览 sandbox 不含 allow-same-origin，
// 脚本跨源，无法访问父页/外壳 DOM。

export const BRIDGE_SCRIPT = `<script>
(function(){
  function freezeForms() {
    var inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(function(el) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.setAttribute('value', el.value);
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked) el.setAttribute('checked', '');
          else el.removeAttribute('checked');
        }
      } else if (el.tagName === 'SELECT') {
        Array.prototype.forEach.call(el.options, function(opt, idx) {
          if (idx === el.selectedIndex) opt.setAttribute('selected', '');
          else opt.removeAttribute('selected');
        });
      }
    });
  }
  // 预览帧内同样禁止导航：预览是渲染保真视图，没有返回入口，
  // 点一次 <a href> 预览就被目标页覆盖，用户只能关掉再开。
  document.addEventListener('click', function(e){
    var t = e.target;
    if (t && t.closest && t.closest('a[href], area[href]')) e.preventDefault();
  }, true);
  document.addEventListener('auxclick', function(e){
    var t = e.target;
    if (t && t.closest && t.closest('a[href], area[href]')) e.preventDefault();
  }, true);
  document.addEventListener('submit', function(e){ e.preventDefault(); }, true);
  window.addEventListener('message', function(event){
    if (event.data === 'ep:extract') {
      freezeForms();
      var html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
      event.source.postMessage({ type: 'ep:extracted', html: html }, '*');
    }
  });
})();
</script>`;

export function injectBridge(html: string): string {
  if (html.includes('</body>')) return html.replace('</body>', BRIDGE_SCRIPT + '</body>');
  return html + BRIDGE_SCRIPT;
}
