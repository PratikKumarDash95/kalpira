import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('[supabaseDb] Supabase URL/key is not configured.');
}

const supabase = createClient(supabaseUrl || 'http://localhost', supabaseKey || 'missing-key', {
  auth: { persistSession: false, autoRefreshToken: false },
});

const tables = {
  user: 'User',
  resume: 'Resume',
  skill: 'Skill',
  userSkill: 'UserSkill',
  study: 'Study',
  storedInterview: 'StoredInterview',
  interviewSession: 'InterviewSession',
  question: 'Question',
  response: 'Response',
  scoreBreakdown: 'ScoreBreakdown',
  weakSkillMemory: 'WeakSkillMemory',
  improvementPlan: 'ImprovementPlan',
  badge: 'Badge',
  readinessIndex: 'ReadinessIndex',
} as const;

type ModelName = keyof typeof tables;
type Row = Record<string, any>;
type Delegate = {
  findMany(args?: Row): Promise<any[]>;
  findFirst(args?: Row): Promise<any | null>;
  findUnique(args: Row): Promise<any | null>;
  create(args: Row): Promise<any>;
  update(args: Row): Promise<any>;
  upsert(args: Row): Promise<any>;
  delete(args: Row): Promise<any>;
  deleteMany(args?: Row): Promise<{ count: number }>;
  count(args?: Row): Promise<number>;
};

type SupabaseDb = {
  user: Delegate;
  resume: Delegate;
  skill: Delegate;
  userSkill: Delegate;
  study: Delegate;
  storedInterview: Delegate;
  interviewSession: Delegate;
  question: Delegate;
  response: Delegate;
  scoreBreakdown: Delegate;
  weakSkillMemory: Delegate;
  improvementPlan: Delegate;
  badge: Delegate;
  readinessIndex: Delegate;
  $transaction<T>(callback: (tx: SupabaseDb) => Promise<T>): Promise<T>;
  $queryRaw(...args: any[]): Promise<any>;
};

const dateFields = new Set([
  'createdAt',
  'updatedAt',
  'startedAt',
  'completedAt',
  'lastUpdated',
  'lastOccurredAt',
  'generatedAt',
  'awardedAt',
  'calculatedAt',
]);

function normalizeRow<T>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const out: Row = { ...(row as Row) };
  for (const key of Object.keys(out)) {
    if (dateFields.has(key) && typeof out[key] === 'string') {
      out[key] = new Date(out[key]);
    }
  }
  return out as T;
}

function normalizeRows<T>(rows: T[]): T[] {
  return rows.map(normalizeRow);
}

function toDbData(data: Row = {}): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'increment' in value) {
      continue;
    }
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out;
}

function getByPath(row: Row, path: string): any {
  return path.split('.').reduce((value, part) => value?.[part], row);
}

function matchesWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR' && Array.isArray(expected)) return expected.some((item) => matchesWhere(row, item));
    if (key === 'AND' && Array.isArray(expected)) return expected.every((item) => matchesWhere(row, item));
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('in' in expected) return expected.in.includes(row[key]);
      if ('not' in expected) return row[key] !== expected.not;
      if ('equals' in expected) return row[key] === expected.equals;
      if (key === 'study' && expected.userId !== undefined) return row.study?.userId === expected.userId;
      return matchesWhere(row[key] || {}, expected);
    }
    return row[key] === expected;
  });
}

function applySelect(row: Row, select?: Row): Row {
  if (!select) return row;
  const out: Row = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled === true) out[key] = row[key];
  }
  return out;
}

function applyOrder(rows: Row[], orderBy?: Row): Row[] {
  if (!orderBy) return rows;
  const [field, direction] = Object.entries(orderBy)[0] || [];
  if (!field) return rows;
  return [...rows].sort((a, b) => {
    const av = getByPath(a, field);
    const bv = getByPath(b, field);
    if (av === bv) return 0;
    const result = av > bv ? 1 : -1;
    return direction === 'desc' ? -result : result;
  });
}

async function allRows(model: ModelName): Promise<Row[]> {
  const { data, error } = await supabase.from(tables[model]).select('*');
  if (error) throw error;
  return normalizeRows(data || []);
}

async function rowsWhere(model: ModelName, where?: Row): Promise<Row[]> {
  const rows = await allRows(model);
  if (!where || Object.keys(where).length === 0) return rows;
  return rows.filter((row) => matchesWhere(row, where));
}

async function loadRelations(model: ModelName, row: Row, include?: Row): Promise<Row> {
  if (!include) return row;
  const out = { ...row };

  if (model === 'user') {
    if (include.resume) out.resume = await db.resume.findFirst({ where: { userId: row.id } });
    if (include.userSkills) {
      const skills = await db.userSkill.findMany({ where: { userId: row.id } });
      out.userSkills = include.userSkills.include?.skill
        ? await Promise.all(skills.map(async (s: Row) => ({ ...s, skill: await db.skill.findUnique({ where: { id: s.skillId } }) })))
        : skills;
    }
    if (include.interviewSessions) out.interviewSessions = await db.interviewSession.findMany({ where: { userId: row.id }, include: include.interviewSessions.include });
    if (include.readinessIndex) out.readinessIndex = await db.readinessIndex.findUnique({ where: { userId: row.id } });
    if (include.badges) out.badges = await db.badge.findMany({ where: { userId: row.id } });
    if (include.improvementPlans) out.improvementPlans = await db.improvementPlan.findMany({ where: { userId: row.id } });
    if (include.weakSkillMemories) out.weakSkillMemories = await db.weakSkillMemory.findMany({ where: { userId: row.id } });
    if (include.studies) out.studies = await db.study.findMany({ where: { userId: row.id } });
    if (include.storedInterviews) out.storedInterviews = await db.storedInterview.findMany({ where: { userId: row.id } });
    if (include._count) {
      out._count = {
        interviewSessions: await db.interviewSession.count({ where: { userId: row.id } }),
        studies: await db.study.count({ where: { userId: row.id } }),
      };
    }
  }

  if (model === 'study') {
    if (include.interviewSessions) out.interviewSessions = await db.interviewSession.findMany({ where: { studyId: row.id }, select: include.interviewSessions.select });
    if (include.storedInterviews) out.storedInterviews = await db.storedInterview.findMany({ where: { studyId: row.id } });
    if (include.user) out.user = await db.user.findUnique({ where: { id: row.userId } });
  }

  if (model === 'interviewSession') {
    if (include.questions) out.questions = await db.question.findMany({ where: { sessionId: row.id }, orderBy: include.questions.orderBy, include: include.questions.include, select: include.questions.select });
    if (include.responses) out.responses = await db.response.findMany({ where: { sessionId: row.id } });
    if (include.scoreBreakdown) out.scoreBreakdown = await db.scoreBreakdown.findUnique({ where: { sessionId: row.id } });
    if (include.study) out.study = row.studyId ? await db.study.findUnique({ where: { id: row.studyId } }) : null;
  }

  if (model === 'question' && include.responses) {
    out.responses = await db.response.findMany({ where: { questionId: row.id } });
  }

  return out;
}

function delegate(model: ModelName) {
  return {
    async findMany(args: Row = {}) {
      let rows = await rowsWhere(model, args.where);
      rows = await Promise.all(rows.map((row) => loadRelations(model, row, args.include)));
      rows = applyOrder(rows, args.orderBy);
      if (typeof args.take === 'number') rows = rows.slice(0, args.take);
      return rows.map((row) => applySelect(row, args.select));
    },
    async findFirst(args: Row = {}) {
      const rows = await this.findMany({ ...args, take: 1 });
      return rows[0] || null;
    },
    async findUnique(args: Row) {
      return this.findFirst(args);
    },
    async create(args: Row) {
      const data = { id: crypto.randomUUID(), ...toDbData(args.data || {}) };
      const { data: row, error } = await supabase.from(tables[model]).insert(data).select('*').single();
      if (error) throw error;
      return normalizeRow(row);
    },
    async update(args: Row) {
      const existing = await this.findFirst({ where: args.where });
      if (!existing) throw new Error(`${tables[model]} row not found`);
      const patch = toDbData(args.data || {});
      for (const [key, value] of Object.entries(args.data || {})) {
        if (value && typeof value === 'object' && 'increment' in value) {
          patch[key] = (existing[key] || 0) + Number(value.increment || 0);
        }
      }
      if ('updatedAt' in existing && !('updatedAt' in patch)) patch.updatedAt = new Date().toISOString();
      const { data: row, error } = await supabase.from(tables[model]).update(patch).eq('id', existing.id).select('*').single();
      if (error) throw error;
      return normalizeRow(row);
    },
    async upsert(args: Row) {
      const existing = await this.findFirst({ where: args.where });
      if (existing) return this.update({ where: { id: existing.id }, data: args.update });
      return this.create({ data: { ...args.create, ...args.where } });
    },
    async delete(args: Row) {
      const existing = await this.findFirst({ where: args.where });
      if (!existing) throw new Error(`${tables[model]} row not found`);
      const { error } = await supabase.from(tables[model]).delete().eq('id', existing.id);
      if (error) throw error;
      return existing;
    },
    async deleteMany(args: Row = {}) {
      const rows = await rowsWhere(model, args.where);
      for (const row of rows) {
        const { error } = await supabase.from(tables[model]).delete().eq('id', row.id);
        if (error) throw error;
      }
      return { count: rows.length };
    },
    async count(args: Row = {}) {
      const rows = await rowsWhere(model, args.where);
      return rows.length;
    },
  };
}

const db: SupabaseDb = {
  user: delegate('user'),
  resume: delegate('resume'),
  skill: delegate('skill'),
  userSkill: delegate('userSkill'),
  study: delegate('study'),
  storedInterview: delegate('storedInterview'),
  interviewSession: delegate('interviewSession'),
  question: delegate('question'),
  response: delegate('response'),
  scoreBreakdown: delegate('scoreBreakdown'),
  weakSkillMemory: delegate('weakSkillMemory'),
  improvementPlan: delegate('improvementPlan'),
  badge: delegate('badge'),
  readinessIndex: delegate('readinessIndex'),
  async $transaction<T>(callback: (tx: SupabaseDb) => Promise<T>): Promise<T> {
    return callback(db);
  },
  async $queryRaw(..._args: any[]) {
    const { error } = await supabase.from('User').select('id').limit(1);
    if (error) throw error;
    return [{ ok: 1 }];
  },
};

export default db;
