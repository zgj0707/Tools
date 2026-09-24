// 多文件夹具的外部脚本。它做两件事：
//   1. 证明「脚本没跟过去 ⇒ 交互失灵」这条后果是真的；
//   2. 让 `hadScript` 为真，顺带验证保存提示里那句「页面含脚本」的补充说明。
document.getElementById('tick').textContent = '脚本已跑起来。';

let n = 0;
document.getElementById('btn').addEventListener('click', () => {
  n += 1;
  document.getElementById('tick').textContent = `点了 ${n} 次。`;
});
