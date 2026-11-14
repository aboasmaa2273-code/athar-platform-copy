import { AuditLogEntry, ClassroomVisit, ImprovementPlan, Teacher, User } from '../types';
import { CentralApiResponse, CentralDatabaseClient, CentralSessionUser } from './centralDatabaseClient';

export type CentralDataSnapshot = {
  teachers: Teacher[];
  visits: ClassroomVisit[];
  plans: ImprovementPlan[];
};

export type CentralDiagnostics = {
  role: CentralSessionUser['role'];
  counts: { teachers: number; visits: number; plans: number };
  stableRead: boolean;
  ownershipVerified: boolean;
  teacherDirectoryBlocked: boolean | null;
  errors: string[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function unwrapRecords<T extends { id?: string }>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error('استجابة السجلات المركزية غير صالحة.');
  return value.map((item) => {
    if (!isObject(item) || !isObject(item.payload)) {
      throw new Error('تعذر قراءة أحد السجلات المركزية؛ لم يتم استبدال أي بيانات محلية.');
    }
    const payload = item.payload as T;
    const id = String(payload.id || item.recordId || '');
    if (!id) throw new Error('يوجد سجل مركزي دون معرّف؛ أوقفنا التحميل لحماية البيانات.');
    return { ...payload, id } as T;
  });
}

const fingerprint = (snapshot: CentralDataSnapshot): string =>
  JSON.stringify({
    teachers: snapshot.teachers.map(x => x.id).sort(),
    visits: snapshot.visits.map(x => x.id).sort(),
    plans: snapshot.plans.map(x => x.id).sort()
  });

/**
 * طبقة بيانات مركزية مستقلة. لا تقرأ localStorage ولا تكتب إليه ولا تحذف منه.
 * تبقى الواجهة القديمة مصدرًا منفصلًا حتى تتطابق جلسة الخادم مع المستخدم الحالي.
 */
export class CentralDataRepository {
  static isReady(): boolean {
    return Boolean(CentralDatabaseClient.getSession());
  }

  static getSignedInUser(): CentralSessionUser | null {
    return CentralDatabaseClient.getSession()?.user || null;
  }

  static matchesAppUser(appUser: User): boolean {
    const central = this.getSignedInUser();
    if (!central || !appUser) return false;
    const normalize = (v: string) => String(v || '').trim().toLocaleLowerCase();
    return central.role === appUser.role &&
      normalize(central.name) === normalize(appUser.name) &&
      normalize(central.schoolId) === normalize(appUser.schoolId) &&
      (central.role !== 'teacher' || normalize(central.jobNumber || '') === normalize(appUser.jobNumber || ''));
  }

  static async loadSnapshot(): Promise<{ success: true; data: CentralDataSnapshot } | { success: false; error: string }> {
    if (!this.isReady()) return { success: false, error: 'يجب تسجيل الدخول المركزي أولاً.' };
    try {
      const user = this.getSignedInUser();
      if (!user) throw new Error('انتهت الجلسة المركزية؛ سجّل الدخول مجدداً.');
      const emptyTeachersResult: CentralApiResponse<{ records?: unknown[] }> = { success: true, records: [] };
      const [teachersResult, visitsResult, plansResult] = await Promise.all([
        user.role === 'teacher'
          ? Promise.resolve(emptyTeachersResult)
          : CentralDatabaseClient.listRecords<{ records?: unknown[] }>('teachers'),
        CentralDatabaseClient.listRecords<{ records?: unknown[] }>('visits'),
        CentralDatabaseClient.listRecords<{ records?: unknown[] }>('plans')
      ]);
      for (const result of [teachersResult, visitsResult, plansResult]) {
        if (!result.success) throw new Error(result.error || 'تعذر جلب السجلات المركزية.');
      }
      return {
        success: true,
        data: {
          teachers: unwrapRecords<Teacher>(teachersResult.records),
          visits: unwrapRecords<ClassroomVisit>(visitsResult.records),
          plans: unwrapRecords<ImprovementPlan>(plansResult.records)
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر تحميل البيانات المركزية.' };
    }
  }

  private static prepareRecord<T extends { id: string; schoolId?: string }>(
    record: T,
    entity: 'teachers' | 'visits' | 'plans'
  ): Record<string, unknown> {
    const session = CentralDatabaseClient.getSession();
    if (!session) throw new Error('انتهت الجلسة المركزية؛ سجّل الدخول مجدداً.');
    const prepared: Record<string, unknown> = { ...record, schoolId: session.user.schoolId };
    if ((entity === 'visits' || entity === 'plans') && session.user.role === 'evaluator') {
      // Evaluator ownership is always derived from the authenticated server session.
      prepared.evaluatorId = session.user.userId;
    }
    return prepared;
  }

  static async saveTeacher(record: Teacher): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await CentralDatabaseClient.saveRecord('teachers', this.prepareRecord(record, 'teachers'));
      return result.success ? { success: true } : { success: false, error: result.error || 'تعذر حفظ بيانات المعلم مركزياً.' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر حفظ بيانات المعلم.' };
    }
  }

  static async setTeacherStatus(record: Teacher, status: Teacher['status']): Promise<{ success: boolean; error?: string }> {
    return this.saveTeacher({ ...record, status });
  }

  static async deleteTeacher(id: string): Promise<{ success: boolean; error?: string }> {
    const result = await CentralDatabaseClient.deleteRecord('teachers', id);
    return result.success ? { success: true } : { success: false, error: result.error || 'تعذر حذف سجل المعلم.' };
  }

  static async importTeachers(records: Teacher[]): Promise<{ success: boolean; imported: number; error?: string }> {
    if (!records.length) return { success: false, imported: 0, error: 'لا توجد سجلات صالحة للاستيراد.' };
    let imported = 0;
    for (let offset = 0; offset < records.length; offset += 100) {
      const batch = records.slice(offset, offset + 100).map(record => ({
        entity: 'teachers' as const,
        record: this.prepareRecord(record, 'teachers')
      }));
      const result = await CentralDatabaseClient.bulkImport(batch);
      if (!result.success) return { success: false, imported, error: result.error || 'توقف الاستيراد؛ راجع السجلات التي حُفظت قبل الخطأ.' };
      imported += Number(result.imported || batch.length);
    }
    return { success: true, imported };
  }

  static async saveVisit(record: ClassroomVisit): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await CentralDatabaseClient.saveRecord('visits', this.prepareRecord(record, 'visits'));
      return result.success ? { success: true } : { success: false, error: result.error || 'تعذر حفظ الزيارة مركزياً.' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر حفظ الزيارة.' };
    }
  }

  static async savePlan(record: ImprovementPlan): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await CentralDatabaseClient.saveRecord('plans', this.prepareRecord(record, 'plans'));
      return result.success ? { success: true } : { success: false, error: result.error || 'تعذر حفظ خطة التطوير مركزياً.' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر حفظ خطة التطوير.' };
    }
  }

  static async updatePlanFollowUp(
    plan: ImprovementPlan,
    changes: Pick<ImprovementPlan, 'status' | 'followUpResult' | 'followUpNotes'>
  ): Promise<{ success: boolean; error?: string }> {
    return this.savePlan({ ...plan, ...changes });
  }

  static async loadAuditLogs(): Promise<{ success: true; records: AuditLogEntry[] } | { success: false; error: string }> {
    const result = await CentralDatabaseClient.listAudit();
    if (!result.success) return { success: false, error: result.error || 'تعذر جلب سجل التدقيق.' };
    const rows = Array.isArray(result.records) ? result.records : [];
    const records = rows.map((row: any, index) => ({
      id: String(row.id || row[0] || `central_audit_${index}`),
      schoolId: String(row.schoolId || row[1] || ''),
      timestamp: String(row.timestamp || row[2] || ''),
      userName: String(row.userName || row[3] || ''),
      userRole: String(row.userRole || row[4] || ''),
      action: String(row.action || row[5] || ''),
      details: String(row.details || row[6] || '')
    }));
    return { success: true, records };
  }

  /** اختبارات قراءة غير مدمرة؛ لا تنشئ سجلات تجريبية ولا تعدّل أي بيانات. */
  static async runReadOnlyDiagnostics(): Promise<{ success: boolean; result?: CentralDiagnostics; error?: string }> {
    const user = this.getSignedInUser();
    if (!user) return { success: false, error: 'لا توجد جلسة مركزية صالحة للاختبار.' };
    const errors: string[] = [];
    const first = await this.loadSnapshot();
    if (!first.success) return { success: false, error: first.error };
    const second = await this.loadSnapshot();
    if (!second.success) return { success: false, error: second.error };
    const stableRead = fingerprint(first.data) === fingerprint(second.data);
    if (!stableRead) errors.push('تغيرت معرّفات السجلات بين قراءتين متتاليتين.');
    let ownershipVerified = true;
    if (user.role === 'evaluator') {
      ownershipVerified = first.data.visits.every(v => v.evaluatorId === user.userId) &&
        first.data.plans.every(p => (p as ImprovementPlan & { evaluatorId?: string }).evaluatorId === user.userId);
      if (!ownershipVerified) errors.push('ظهر سجل لا يحمل معرّف المقيم الحالي؛ أوقف اعتماد البيانات.');
    }
    if (user.role === 'teacher') {
      const job = String(user.jobNumber || '').trim();
      ownershipVerified = Boolean(job) &&
        first.data.visits.every(v => String(v.teacherJobNumber || '').trim() === job) &&
        first.data.plans.every(p => String(p.teacherJobNumber || '').trim() === job);
      if (!ownershipVerified) errors.push('ظهر سجل لا يطابق الرقم الوظيفي لحساب المعلم.');
    }
    let teacherDirectoryBlocked: boolean | null = null;
    if (user.role === 'teacher') {
      const denied = await CentralDatabaseClient.listRecords('teachers');
      teacherDirectoryBlocked = !denied.success;
      if (!teacherDirectoryBlocked) errors.push('الخادم لم يمنع حساب المعلم من قراءة دليل المعلمين.');
    }
    const result: CentralDiagnostics = {
      role: user.role,
      counts: {
        teachers: first.data.teachers.length,
        visits: first.data.visits.length,
        plans: first.data.plans.length
      },
      stableRead,
      ownershipVerified,
      teacherDirectoryBlocked,
      errors
    };
    return { success: errors.length === 0, result, error: errors.join(' ') || undefined };
  }
}
