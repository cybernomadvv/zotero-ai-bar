const demos = {
  ask: '<div class="question">为什么要把属性映射到稠密空间？</div><div class="answer"><span class="answer-label">把概念拆开看</span><p>不同属性可能有不同的维度和表达方式。通过可学习的映射，可以把它们转换成统一维度的向量。</p><p>“稠密”表示信息分布在多个维度中；映射参数则可以随着任务训练而调整。</p><div class="answer-note">回到这篇文献的上下文，理解这个选择。</div></div>',
  translate: '<div class="question">翻译这句话，并保留关键术语。</div><div class="answer"><span class="answer-label">先理解，再继续</span><p>我们通过可学习的嵌入矩阵，将每个属性投影到一个稠密表示空间。</p><p><strong>embedding matrices</strong> → 嵌入矩阵<br><strong>dense representation space</strong> → 稠密表示空间</p><div class="answer-note">优先复用已保存的论文译文和术语。</div></div>',
  resume: '<div class="question">暂停之后，下次从哪里继续？</div><div class="answer"><span class="answer-label">已保存 4 / 9 段 · 进度示意</span><p>完整批次通过校验后，原文、译文和术语一起保存。已完成内容留在本地。</p><p>再次继续时，跳过已保存的 4 段，处理剩余 5 段。尚未完成的批次会重新请求。</p><div class="answer-note">全部处理并写盘成功后，才标记全文完成。</div></div>',
};
const tabs = [...document.querySelectorAll('[data-demo]')];
const panel = document.querySelector('#demo-answer');
for (const tab of tabs) {
  tab.addEventListener('click', () => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    }
    panel.innerHTML = demos[tab.dataset.demo];
    panel.setAttribute('aria-labelledby', tab.id);
  });
  tab.addEventListener('keydown', (event) => {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[index].focus();
    tabs[index].click();
  });
}
