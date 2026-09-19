/**
 * The Calculator module's engine.
 *
 * A recursive-descent parser rather than `eval`, for the same reason
 * `calculate` in `web.ts` is one: the input is typed by a person into a text
 * field, and a desktop surface has no business executing it. This one is the
 * fuller sibling a panel wants - variables and `ans`, implicit multiplication
 * (`2pi`, `3(4+1)`), postfix `!` and `%`, the relative percent a calculator
 * does (`200 + 10%` is 220, not 200.1), hex/binary/octal literals, and unit and
 * base conversion (`5 km to mi`, `255 to hex`).
 *
 * Pure: no DOM, no host, no state. The panel keeps the variables; this only
 * reads them. That is what lets `npm test` exercise the shipped file.
 */

export type AngleMode = 'deg' | 'rad';

export interface CalcOptions {
  angle?: AngleMode;
  /** Names the expression may read, `ans` among them. */
  variables?: Readonly<Record<string, number>>;
}

export type OutputBase = 2 | 8 | 10 | 16;

export type CalcResult =
  | {
      ok: true;
      value: number;
      /** The canonical label of the unit the value is in, if any. */
      unit: string | null;
      base: OutputBase;
      /** Set when the input was `name = expression`. */
      assigned: string | null;
    }
  | { ok: false; error: string };

// --------------------------------------------------------------------- units

interface UnitDef {
  dim: string;
  label: string;
  /** Multiplies into the dimension's base unit, after `offset` is added. */
  factor: number;
  offset?: number;
}

const UNITS: Record<string, UnitDef> = {};
const UNITS_FOLDED: Record<string, UnitDef> = {};

function unit(dim: string, label: string, factor: number, aliases: string[], offset = 0): void {
  const def: UnitDef = { dim, label, factor, offset };
  for (const name of [label, ...aliases]) {
    UNITS[name] = def;
    // Case-folded lookups are a fallback only: `Mb` and `MB` are different
    // units, and the exact spelling always wins when there is one.
    UNITS_FOLDED[name.toLowerCase()] ??= def;
  }
}

// Length, in metres.
unit('length', 'm', 1, ['meter', 'meters', 'metre', 'metres']);
unit('length', 'km', 1000, ['kilometer', 'kilometers', 'kilometre', 'kilometres']);
unit('length', 'cm', 0.01, ['centimeter', 'centimeters', 'centimetre', 'centimetres']);
unit('length', 'mm', 0.001, ['millimeter', 'millimeters', 'millimetre', 'millimetres']);
unit('length', 'µm', 1e-6, ['um', 'micron', 'microns']);
unit('length', 'nm', 1e-9, ['nanometer', 'nanometers']);
unit('length', 'mi', 1609.344, ['mile', 'miles']);
unit('length', 'yd', 0.9144, ['yard', 'yards']);
unit('length', 'ft', 0.3048, ['foot', 'feet']);
unit('length', 'in', 0.0254, ['inch', 'inches']);
unit('length', 'nmi', 1852, ['nautical mile', 'nauticalmile']);

// Mass, in kilograms.
unit('mass', 'kg', 1, ['kilogram', 'kilograms', 'kilo', 'kilos']);
unit('mass', 'g', 0.001, ['gram', 'grams']);
unit('mass', 'mg', 1e-6, ['milligram', 'milligrams']);
unit('mass', 't', 1000, ['tonne', 'tonnes', 'ton', 'tons']);
unit('mass', 'lb', 0.45359237, ['lbs', 'pound', 'pounds']);
unit('mass', 'oz', 0.028349523125, ['ounce', 'ounces']);
unit('mass', 'st', 6.35029318, ['stone', 'stones']);

// Time, in seconds.
unit('time', 's', 1, ['sec', 'secs', 'second', 'seconds']);
unit('time', 'ms', 0.001, ['millisecond', 'milliseconds']);
unit('time', 'min', 60, ['mins', 'minute', 'minutes']);
unit('time', 'h', 3600, ['hr', 'hrs', 'hour', 'hours']);
unit('time', 'd', 86_400, ['day', 'days']);
unit('time', 'wk', 604_800, ['week', 'weeks']);
unit('time', 'yr', 31_556_952, ['year', 'years']);

// Temperature, in kelvin: `(value + offset) * factor`.
unit('temperature', '°C', 1, ['c', 'C', 'celsius', 'degc'], 273.15);
unit('temperature', '°F', 5 / 9, ['f', 'F', 'fahrenheit', 'degf'], 459.67);
unit('temperature', 'K', 1, ['k', 'kelvin']);

// Data, in bits. Lower-case `kb`/`mb`/`gb` are read as bytes, because that is
// what people mean when they type them; `Kb`/`Mb`/`Gb` stay bits.
unit('data', 'bit', 1, ['bits', 'b']);
unit('data', 'B', 8, ['byte', 'bytes']);
unit('data', 'KB', 8e3, ['kB', 'kb', 'kilobyte', 'kilobytes']);
unit('data', 'MB', 8e6, ['mb', 'megabyte', 'megabytes']);
unit('data', 'GB', 8e9, ['gb', 'gigabyte', 'gigabytes']);
unit('data', 'TB', 8e12, ['tb', 'terabyte', 'terabytes']);
unit('data', 'Kb', 1e3, ['kbit']);
unit('data', 'Mb', 1e6, ['mbit']);
unit('data', 'Gb', 1e9, ['gbit']);
unit('data', 'KiB', 8 * 1024, ['kib']);
unit('data', 'MiB', 8 * 1024 ** 2, ['mib']);
unit('data', 'GiB', 8 * 1024 ** 3, ['gib']);
unit('data', 'TiB', 8 * 1024 ** 4, ['tib']);

// Area, in square metres.
unit('area', 'm²', 1, ['m2', 'sqm']);
unit('area', 'km²', 1e6, ['km2']);
unit('area', 'cm²', 1e-4, ['cm2']);
unit('area', 'ha', 1e4, ['hectare', 'hectares']);
unit('area', 'acre', 4046.8564224, ['acres']);
unit('area', 'ft²', 0.09290304, ['ft2', 'sqft']);
unit('area', 'mi²', 2_589_988.110336, ['mi2']);

// Volume, in cubic metres.
unit('volume', 'L', 0.001, ['l', 'liter', 'liters', 'litre', 'litres']);
unit('volume', 'mL', 1e-6, ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']);
unit('volume', 'cL', 1e-5, ['cl']);
unit('volume', 'dL', 1e-4, ['dl']);
unit('volume', 'm³', 1, ['m3']);
unit('volume', 'gal', 0.003785411784, ['gallon', 'gallons']);
unit('volume', 'qt', 0.000946352946, ['quart', 'quarts']);
unit('volume', 'pt', 0.000473176473, ['pint', 'pints']);
unit('volume', 'cup', 0.0002365882365, ['cups']);
unit('volume', 'fl oz', 2.95735295625e-5, ['floz']);
unit('volume', 'tbsp', 1.478676478125e-5, ['tablespoon', 'tablespoons']);
unit('volume', 'tsp', 4.92892159375e-6, ['teaspoon', 'teaspoons']);

// Speed, in metres per second.
unit('speed', 'm/s', 1, ['mps']);
unit('speed', 'km/h', 1 / 3.6, ['kmh', 'kph']);
unit('speed', 'mph', 0.44704, []);
unit('speed', 'kn', 1852 / 3600, ['knot', 'knots', 'kt']);
unit('speed', 'ft/s', 0.3048, ['fps']);

// Energy, in joules.
unit('energy', 'J', 1, ['j', 'joule', 'joules']);
unit('energy', 'kJ', 1000, ['kj']);
unit('energy', 'cal', 4.184, ['calorie', 'calories']);
unit('energy', 'kcal', 4184, ['kilocalorie', 'kilocalories']);
unit('energy', 'Wh', 3600, ['wh']);
unit('energy', 'kWh', 3.6e6, ['kwh']);

// Power, in watts.
unit('power', 'W', 1, ['w', 'watt', 'watts']);
unit('power', 'kW', 1000, ['kw', 'kilowatt', 'kilowatts']);
unit('power', 'hp', 745.69987158227022, ['horsepower']);

// Pressure, in pascals.
unit('pressure', 'Pa', 1, ['pa', 'pascal', 'pascals']);
unit('pressure', 'hPa', 100, ['hpa', 'mbar']);
unit('pressure', 'kPa', 1000, ['kpa']);
unit('pressure', 'bar', 1e5, []);
unit('pressure', 'psi', 6894.757293168, []);
unit('pressure', 'atm', 101_325, []);
unit('pressure', 'mmHg', 133.322387415, ['mmhg']);

// Angle, in radians.
unit('angle', 'rad', 1, ['radian', 'radians']);
unit('angle', '°', Math.PI / 180, ['deg', 'degree', 'degrees']);
unit('angle', 'turn', 2 * Math.PI, ['turns']);

/** Longest first, so `km/h` is tried before `h` and `mph` before `h`. */
const UNIT_NAMES = Object.keys(UNITS).sort((a, b) => b.length - a.length);

function findUnit(name: string): UnitDef | null {
  return UNITS[name] ?? UNITS_FOLDED[name.toLowerCase()] ?? null;
}

const BASES: Record<string, OutputBase> = {
  hex: 16,
  hexadecimal: 16,
  bin: 2,
  binary: 2,
  oct: 8,
  octal: 8,
  dec: 10,
  decimal: 10,
};

// ----------------------------------------------------------------- functions

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
  tau: 2 * Math.PI,
  phi: (1 + Math.sqrt(5)) / 2,
};

class CalcError extends Error {}

function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new CalcError('Factorial needs a whole number of 0 or more.');
  if (n > 170) return Infinity;
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

function gcd(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

type Fn = { min: number; max: number; run: (args: number[], angle: AngleMode) => number };

const toRad = (x: number, angle: AngleMode) => (angle === 'deg' ? (x * Math.PI) / 180 : x);
const fromRad = (x: number, angle: AngleMode) => (angle === 'deg' ? (x * 180) / Math.PI : x);

/** `sin(180)` in degrees is 1.2e-16 in floating point; a calculator says 0. */
const tidy = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);

const one = (run: (x: number, angle: AngleMode) => number): Fn => ({
  min: 1,
  max: 1,
  run: (a, angle) => run(a[0] as number, angle),
});

const many = (min: number, run: (args: number[]) => number): Fn => ({ min, max: 64, run: (a) => run(a) });

const FUNCTIONS: Record<string, Fn> = {
  sqrt: one(Math.sqrt),
  cbrt: one(Math.cbrt),
  abs: one(Math.abs),
  floor: one(Math.floor),
  ceil: one(Math.ceil),
  trunc: one(Math.trunc),
  sign: one(Math.sign),
  exp: one(Math.exp),
  ln: one(Math.log),
  log2: one(Math.log2),
  log10: one(Math.log10),
  log: { min: 1, max: 2, run: ([x, base]) => (base === undefined ? Math.log10(x as number) : Math.log(x as number) / Math.log(base)) },
  round: {
    min: 1,
    max: 2,
    run: ([x, digits]) => {
      const f = 10 ** Math.round(digits ?? 0);
      return Math.round((x as number) * f) / f;
    },
  },
  sin: one((x, angle) => tidy(Math.sin(toRad(x, angle)))),
  cos: one((x, angle) => tidy(Math.cos(toRad(x, angle)))),
  tan: one((x, angle) => tidy(Math.tan(toRad(x, angle)))),
  asin: one((x, angle) => fromRad(Math.asin(x), angle)),
  acos: one((x, angle) => fromRad(Math.acos(x), angle)),
  atan: one((x, angle) => fromRad(Math.atan(x), angle)),
  atan2: { min: 2, max: 2, run: ([y, x], angle) => fromRad(Math.atan2(y as number, x as number), angle) },
  sinh: one(Math.sinh),
  cosh: one(Math.cosh),
  tanh: one(Math.tanh),
  deg: one((x) => (x * 180) / Math.PI),
  rad: one((x) => (x * Math.PI) / 180),
  pow: { min: 2, max: 2, run: ([x, y]) => (x as number) ** (y as number) },
  hypot: many(1, (a) => Math.hypot(...a)),
  min: many(1, (a) => Math.min(...a)),
  max: many(1, (a) => Math.max(...a)),
  sum: many(1, (a) => a.reduce((s, x) => s + x, 0)),
  avg: many(1, (a) => a.reduce((s, x) => s + x, 0) / a.length),
  mean: many(1, (a) => a.reduce((s, x) => s + x, 0) / a.length),
  mod: { min: 2, max: 2, run: ([x, y]) => (((x as number) % (y as number)) + (y as number)) % (y as number) },
  gcd: many(2, (a) => a.reduce((g, x) => gcd(g, x))),
  lcm: many(2, (a) => a.reduce((l, x) => Math.abs(Math.round(l * x)) / gcd(l, x))),
  fact: one(factorial),
  ncr: {
    min: 2,
    max: 2,
    run: ([n, r]) => factorial(n as number) / (factorial(r as number) * factorial((n as number) - (r as number))),
  },
  npr: { min: 2, max: 2, run: ([n, r]) => factorial(n as number) / factorial((n as number) - (r as number)) },
  random: { min: 0, max: 0, run: () => Math.random() },
};

// ----------------------------------------------------------------- tokenizer

type Token =
  | { t: 'num'; v: number; at: number }
  | { t: 'id'; v: string; at: number }
  | { t: 'op'; v: string; at: number };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const radix = /^0([xbo])([0-9a-f_]+)/i.exec(rest);
    if (radix) {
      const base = { x: 16, b: 2, o: 8 }[(radix[1] as string).toLowerCase() as 'x' | 'b' | 'o'];
      const digits = (radix[2] as string).replace(/_/g, '');
      const value = parseInt(digits, base);
      if (!Number.isFinite(value) || digits.length === 0) throw new CalcError(`"${radix[0]}" is not a number.`);
      tokens.push({ t: 'num', v: value, at: i });
      i += radix[0].length;
      continue;
    }
    const num = /^(\d[\d_]*\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest);
    if (num) {
      tokens.push({ t: 'num', v: Number(num[0].replace(/_/g, '')), at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[a-zA-Zπ_][a-zA-Z0-9_]*/.exec(rest);
    if (id) {
      tokens.push({ t: 'id', v: id[0], at: i });
      i += id[0].length;
      continue;
    }
    if (rest.startsWith('**')) {
      tokens.push({ t: 'op', v: '^', at: i });
      i += 2;
      continue;
    }
    const map: Record<string, string> = { '×': '*', '·': '*', '÷': '/', '−': '-', '–': '-' };
    const op = map[c] ?? c;
    if ('+-*/^%!(),=|'.includes(op)) {
      tokens.push({ t: 'op', v: op, at: i });
      i++;
      continue;
    }
    throw new CalcError(`"${c}" is not something a calculator understands.`);
  }
  return tokens;
}

// -------------------------------------------------------------------- parser

interface Operand {
  value: number;
  /** A bare `n%`, which `+` and `-` read relative to their left side. */
  percent: boolean;
}

class Parser {
  #tokens: Token[];
  #pos = 0;
  #angle: AngleMode;
  #vars: Readonly<Record<string, number>>;

  constructor(tokens: Token[], angle: AngleMode, vars: Readonly<Record<string, number>>) {
    this.#tokens = tokens;
    this.#angle = angle;
    this.#vars = vars;
  }

  get done(): boolean {
    return this.#pos >= this.#tokens.length;
  }

  #peek(offset = 0): Token | undefined {
    return this.#tokens[this.#pos + offset];
  }

  #isOp(value: string, offset = 0): boolean {
    const token = this.#peek(offset);
    return token?.t === 'op' && token.v === value;
  }

  #expect(value: string): void {
    if (!this.#isOp(value)) {
      const token = this.#peek();
      throw new CalcError(token ? `Expected "${value}" before "${String(token.v)}".` : `Missing "${value}".`);
    }
    this.#pos++;
  }

  /** True when the next token can begin an operand, for implicit `*`. */
  #startsOperand(): boolean {
    const token = this.#peek();
    if (!token) return false;
    if (token.t !== 'op') return true;
    return token.v === '(';
  }

  expression(): number {
    return this.#sum().value;
  }

  #sum(): Operand {
    let left = this.#product();
    while (this.#isOp('+') || this.#isOp('-')) {
      const op = (this.#peek() as Token).v;
      this.#pos++;
      const right = this.#product();
      // `200 + 10%` means 10% of 200 on top of it, as every desk calculator has it.
      const amount = right.percent ? left.value * right.value : right.value;
      left = { value: op === '+' ? left.value + amount : left.value - amount, percent: false };
    }
    return left;
  }

  #product(): Operand {
    let left = this.#unary();
    for (;;) {
      if (this.#isOp('*') || this.#isOp('/') || this.#isOp('%')) {
        const op = (this.#peek() as Token).v;
        this.#pos++;
        const right = this.#unary().value;
        if (op === '*') left = { value: left.value * right, percent: false };
        else if (right === 0) throw new CalcError(op === '/' ? 'Division by zero.' : 'Modulo by zero.');
        else left = { value: op === '/' ? left.value / right : left.value % right, percent: false };
        continue;
      }
      const token = this.#peek();
      if (token?.t === 'id' && token.v.toLowerCase() === 'mod' && this.#peek(1)) {
        this.#pos++;
        const right = this.#unary().value;
        if (right === 0) throw new CalcError('Modulo by zero.');
        left = { value: left.value % right, percent: false };
        continue;
      }
      // `2pi`, `3(4+1)`, `(1+2)(3+4)`.
      if (this.#startsOperand()) {
        left = { value: left.value * this.#power().value, percent: false };
        continue;
      }
      return left;
    }
  }

  #unary(): Operand {
    if (this.#isOp('-')) {
      this.#pos++;
      const inner = this.#unary();
      return { value: -inner.value, percent: inner.percent };
    }
    if (this.#isOp('+')) {
      this.#pos++;
      return this.#unary();
    }
    return this.#power();
  }

  /** Right-associative, and tighter than unary minus: `-2^2` is -4. */
  #power(): Operand {
    const base = this.#postfix();
    if (this.#isOp('^')) {
      this.#pos++;
      const exponent = this.#unary().value;
      return { value: base.value ** exponent, percent: false };
    }
    return base;
  }

  #postfix(): Operand {
    let operand: Operand = { value: this.#primary(), percent: false };
    for (;;) {
      if (this.#isOp('!')) {
        this.#pos++;
        operand = { value: factorial(operand.value), percent: false };
        continue;
      }
      // `%` is a percent only where no operand follows it; `10 % 3` is modulo.
      if (this.#isOp('%')) {
        const next = this.#peek(1);
        const operandFollows = next && (next.t !== 'op' || next.v === '(');
        if (operandFollows) return operand;
        this.#pos++;
        operand = { value: operand.value / 100, percent: true };
        continue;
      }
      return operand;
    }
  }

  #primary(): number {
    const token = this.#peek();
    if (!token) throw new CalcError('The expression ends too early.');

    if (token.t === 'num') {
      this.#pos++;
      return token.v;
    }

    if (token.t === 'op') {
      if (token.v === '(') {
        this.#pos++;
        const value = this.#sum().value;
        this.#expect(')');
        return value;
      }
      if (token.v === '|') {
        this.#pos++;
        const value = this.#sum().value;
        this.#expect('|');
        return Math.abs(value);
      }
      throw new CalcError(`Unexpected "${token.v}".`);
    }

    this.#pos++;
    const name = token.v;
    const lower = name.toLowerCase();

    if (this.#isOp('(')) {
      const fn = FUNCTIONS[lower];
      if (!fn) throw new CalcError(`There is no function called "${name}".`);
      this.#pos++;
      const args: number[] = [];
      if (!this.#isOp(')')) {
        args.push(this.#sum().value);
        while (this.#isOp(',')) {
          this.#pos++;
          args.push(this.#sum().value);
        }
      }
      this.#expect(')');
      if (args.length < fn.min || args.length > fn.max) {
        const wanted = fn.min === fn.max ? `${fn.min}` : `${fn.min} to ${fn.max}`;
        throw new CalcError(`${lower}() takes ${wanted} value${fn.max === 1 ? '' : 's'}.`);
      }
      return fn.run(args, this.#angle);
    }

    if (Object.hasOwn(this.#vars, name)) return this.#vars[name] as number;
    if (Object.hasOwn(CONSTANTS, lower)) return CONSTANTS[lower] as number;
    if (FUNCTIONS[lower]) throw new CalcError(`${lower} needs brackets, like ${lower}(2).`);
    throw new CalcError(`"${name}" is not defined.`);
  }
}

// ---------------------------------------------------------------- evaluation

const RESERVED = new Set([...Object.keys(CONSTANTS), ...Object.keys(FUNCTIONS), 'mod', 'ans']);

function run(src: string, options: CalcOptions): number {
  const parser = new Parser(tokenize(src), options.angle ?? 'rad', options.variables ?? {});
  const value = parser.expression();
  if (!parser.done) throw new CalcError('Something is left over at the end.');
  if (Number.isNaN(value)) throw new CalcError('That has no numeric answer.');
  return value;
}

/** A unit at the very end of `text`, with a boundary before it. */
function trailingUnit(text: string): { expr: string; unit: UnitDef } | null {
  for (const name of UNIT_NAMES) {
    if (text.length <= name.length || !text.endsWith(name)) continue;
    const before = text.slice(0, -name.length);
    // The unit has to be its own word: `5km` and `5 km` are, `2pi` is not `2p` and `i`.
    if (!/[\d)\s.]$/.test(before)) continue;
    const def = UNITS[name] as UnitDef;
    if (before.trim()) return { expr: before.trim(), unit: def };
  }
  // A folded spelling (`5 KM`) as a second pass, never ahead of an exact one.
  const word = /^(.*[\d)\s.])([a-zA-Zµ°²³/]+[23]?)$/.exec(text);
  if (word) {
    const def = UNITS_FOLDED[(word[2] as string).toLowerCase()];
    if (def && (word[1] as string).trim()) return { expr: (word[1] as string).trim(), unit: def };
  }
  return null;
}

function convert(value: number, from: UnitDef, to: UnitDef): number {
  const base = (value + (from.offset ?? 0)) * from.factor;
  return base / to.factor - (to.offset ?? 0);
}

/**
 * Evaluates one line of calculator input.
 *
 * Never throws: a mistake in the input is the normal case while someone is
 * still typing, so it comes back as `{ ok: false }` with a sentence to show.
 */
export function evaluate(input: string, options: CalcOptions = {}): CalcResult {
  const text = input.trim();
  if (!text) return { ok: false, error: '' };

  try {
    // `name = expression`, but not `==` and not a unit conversion.
    const assign = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=(?!=)\s*(.+)$/.exec(text);
    if (assign) {
      const name = assign[1] as string;
      if (RESERVED.has(name.toLowerCase())) throw new CalcError(`"${name}" is a built-in name.`);
      const value = run(assign[2] as string, options);
      return { ok: true, value, unit: null, base: 10, assigned: name };
    }

    // `<expr> [unit] to|in|as|-> <unit or base>`, splitting at the *last*
    // keyword whose right side is a target, so `12 in in cm` works.
    // The trailing space is a lookahead so adjacent keywords can share it -
    // consuming it hid the second `in` of `12 in in cm` from the scan.
    const splits = [...text.matchAll(/\s+(?:to|in|as)(?=\s)|\s*->/gi)].reverse();
    for (const split of splits) {
      const left = text.slice(0, split.index).trim();
      const right = text.slice((split.index ?? 0) + split[0].length).trim();
      if (!left || !right) continue;

      const base = BASES[right.toLowerCase()];
      if (base) {
        const value = run(left, options);
        return { ok: true, value, unit: null, base, assigned: null };
      }

      const target = findUnit(right);
      if (!target) continue;
      const source = trailingUnit(left);
      if (!source) {
        // `5 to km` has nothing to convert from; treat the number as given in
        // the target unit rather than failing on a half-typed line.
        const value = run(left, options);
        return { ok: true, value, unit: target.label, base: 10, assigned: null };
      }
      if (source.unit.dim !== target.dim) {
        throw new CalcError(`Cannot turn ${source.unit.label} (${source.unit.dim}) into ${target.label} (${target.dim}).`);
      }
      const value = convert(run(source.expr, options), source.unit, target);
      return { ok: true, value, unit: target.label, base: 10, assigned: null };
    }

    // A value with a unit and nowhere to go keeps its unit.
    try {
      return { ok: true, value: run(text, options), unit: null, base: 10, assigned: null };
    } catch (err) {
      const source = trailingUnit(text);
      if (!source) throw err;
      return { ok: true, value: run(source.expr, options), unit: source.unit.label, base: 10, assigned: null };
    }
  } catch (err) {
    if (err instanceof CalcError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface FormatOptions {
  /** Significant digits, which is what removes `0.1 + 0.2` noise. */
  precision?: number;
  /** Thousands separators in the integer part. */
  grouping?: boolean;
}

/** A number the way a calculator display shows it. */
export function formatNumber(value: number, options: FormatOptions = {}): string {
  const precision = Math.min(17, Math.max(1, Math.round(options.precision ?? 12)));
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  if (value === 0) return '0';

  const rounded = Number(value.toPrecision(precision));
  const magnitude = Math.abs(rounded);
  if (magnitude >= 1e15 || magnitude < 1e-7) {
    const [mantissa, exponent] = rounded.toExponential(precision - 1).split('e');
    const trimmed = (mantissa as string).includes('.') ? (mantissa as string).replace(/\.?0+$/, '') : mantissa;
    return `${trimmed}e${Number(exponent)}`;
  }
  return rounded.toLocaleString('en-US', {
    useGrouping: options.grouping ?? false,
    maximumFractionDigits: 20,
    maximumSignificantDigits: precision,
  });
}

/** The whole result line: value, unit or base prefix. */
export function formatResult(result: Extract<CalcResult, { ok: true }>, options: FormatOptions = {}): string {
  if (result.base !== 10) {
    const whole = Math.trunc(result.value);
    const sign = whole < 0 ? '-' : '';
    const digits = Math.abs(whole).toString(result.base).toUpperCase();
    const prefix = { 2: '0b', 8: '0o', 16: '0x' }[result.base];
    return `${sign}${prefix}${digits}`;
  }
  const number = formatNumber(result.value, options);
  return result.unit ? `${number} ${result.unit}` : number;
}
