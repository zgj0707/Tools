// 原生 DOM 控件工厂（T108）：不引框架，所有控件外壳节点、带 ep- 前缀，不进被编辑 doc。

export interface FieldHandle {
  el: HTMLElement;
  setValue(v: string): void;
  onCommit(cb: (v: string) => void): void;
  setDisabled(d: boolean): void;
}

/**
 * 把英文 CSS 属性名挂到字段行 label 上做 hover 提示（T122）。
 * 面板文案已统一中文，精确属性名靠 title 保留。
 */
export function hintField(f: { el: HTMLElement }, hint: string): void {
  const lab = f.el.querySelector('label');
  if (lab) lab.title = hint;
}

let fieldSeq = 0;

function wrap(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ep-field';
  const lab = document.createElement('label');
  lab.textContent = label;
  // label 与控件此前没有 for/id 关联（无障碍缺口，也让 getByLabel 不可用）。此处补上。
  if (!control.id) control.id = `ep-field-${++fieldSeq}`;
  lab.htmlFor = control.id;
  row.appendChild(lab);
  row.appendChild(control);
  return row;
}

export function makeSelect(
  label: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  mixedText: string,
): FieldHandle & { setEmptyText(s: string): void } {
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  const mixed = document.createElement('option');
  mixed.value = '';
  mixed.textContent = mixedText;
  sel.appendChild(mixed);
  const row = wrap(label, sel);
  return {
    el: row,
    setValue(v: string) {
      sel.value = v;
    },
    /** 空选项文案随上下文切换：「混合」（多选值不一致）↔「—」（未选中）。 */
    setEmptyText(s: string) {
      mixed.textContent = s;
    },
    onCommit(cb) {
      sel.addEventListener('change', () => cb(sel.value));
    },
    setDisabled(d) {
      sel.disabled = d;
    },
  };
}

export function makeColor(label: string): FieldHandle {
  const input = document.createElement('input');
  input.type = 'color';
  const row = wrap(label, input);
  return {
    el: row,
    setValue(v: string) {
      // input[type=color] 无法表达「空」。空值/无共有值时标 data-unset 视觉降级，
      // 否则会静默沿用上一次的颜色冒充当前值（T122）。
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        input.value = v;
        row.dataset.unset = 'false';
      } else {
        row.dataset.unset = 'true';
      }
    },
    onCommit(cb) {
      input.addEventListener('change', () => cb(input.value));
    },
    setDisabled(d) {
      input.disabled = d;
    },
  };
}

export function makeNumber(label: string, min: number, max: number, step: number): FieldHandle {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  const row = wrap(label, input);
  let last = input.value;
  return {
    el: row,
    setValue(v: string) {
      input.value = v;
      last = v;
    },
    onCommit(cb) {
      input.addEventListener('change', () => cb(input.value));
      input.addEventListener('keydown', (e) => {
        // Enter：值未改变则不提交，避免冗余 inline/历史
        if (e.key === 'Enter' && input.value.trim() !== last.trim()) cb(input.value);
      });
    },
    setDisabled(d) {
      input.disabled = d;
    },
  };
}

export function makeButton(label: string): FieldHandle & { click(cb: () => void): void } {  const btn = document.createElement('button');
  btn.textContent = label;
  const row = wrap('', btn);
  return {
    el: row,
    setValue() {},
    onCommit() {},
    setDisabled(d) {
      btn.disabled = d;
    },
    click(cb) {
      btn.addEventListener('click', () => cb());
    },
  };
}

export function makeText(label: string, placeholder: string): FieldHandle {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  const row = wrap(label, input);
  return {
    el: row,
    setValue(v: string) {
      input.value = v;
    },
    onCommit(cb) {
      input.addEventListener('change', () => cb(input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') cb(input.value);
      });
    },
    setDisabled(d) {
      input.disabled = d;
    },
  };
}
