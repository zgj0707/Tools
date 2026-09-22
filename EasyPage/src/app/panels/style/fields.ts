// 原生 DOM 控件工厂（T108）：不引框架，所有控件外壳节点、带 ep- 前缀，不进被编辑 doc。

export interface FieldHandle {
  el: HTMLElement;
  setValue(v: string): void;
  onCommit(cb: (v: string) => void): void;
  setDisabled(d: boolean): void;
}

function wrap(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ep-field';
  const lab = document.createElement('label');
  lab.textContent = label;
  row.appendChild(lab);
  row.appendChild(control);
  return row;
}

export function makeSelect(
  label: string,
  options: ReadonlyArray<{ value: string; label: string }>,
  mixedText: string,
): FieldHandle {
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
      if (/^#[0-9a-fA-F]{6}$/.test(v)) input.value = v;
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
