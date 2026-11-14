import { AuditLogEntry, ClassroomVisit, ImprovementPlan, Teacher } from '../types';
import { CentralDatabaseClient, CentralSessionUser } from './centralDatabaseClient';

type CentralRecord<T> = {
  recordId: string;
  entity: string;
  payload: T;
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  deletedAt?: string;
};

export type CentralDataSnapshot = {
  teachers: Teacher[];
  visits: ClassroomVisit[];
  plans: ImprovementPlan[];
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

/**
 * طبقة بيانات مستقلة عن التخزين المحلي القديم.
 * لا تنقل البيانات ولا تحذفها ولا تكتب إلى localStorage.
 */
export class CentralDataRepository {
  static isReady(): boolean {
    return Boolean(CentralDatabaseClient.getSession());
  }

  static getSignedInUser(): CentralSessionUser | null {
    return CentralDatabaseClient.getSession()?.user || null;
  }

  static async loadSnapshot(): Promise<{ success: true; data: CentralDataSnapshot } | { success: false; error: string }> {
    if (!this.isReady()) return { success: false, error: 'يجب تسجيل الدخول المركزي أولاً.' };
    try {
      const user = this.getSignedInUser();
      if (!user) throw new Error('انتهت الجلسة المركزية؛ سجّل الدخول مجدداً.');
      const [teachersResult, visitsResult, plansResult] = await Promise.all([
        user.role === 'teacher'
          ? Promise.resolve({ success: true, records: [] } as { success: boolean; records: unknown[] })
          : CentralDatabaseClient.listRecords<{ records?: unknown[] }>('teachers'),
        CentralDatabaseClient.listRecords<{ records?: unknown[] }>('visits'),
        CentralDatabaseClient.listRecords<{ records?: unknown[] }>('plans')
      ]);
      for (const result of [teachersResult, visitsResult, plansResult]) {
        if (!result.success) throw new Error(result.error || 'تعذر جلب السجلات المركزية.');
      }
      const data: CentralDataSnapshot = {
        teachers: unwrapRecords<Teacher>(teachersResult.records),
        visits: unwrapRecords<ClassroomVisit>(visitsResult.records),
        plans: unwrapRecords<ImprovementPlan>(plansResult.records)
      };
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'تعذر تحميل البيانات المركزية.' };
    }
  }

  private static prepareRecord<T extends { id: string; schoolId?: string }>(record: T, entity: 'teachers' | 'visits' | 'plans'): Record<string, unknown> {
    const session = CentralDatabaseClient.getSession();
    if (!session) throw new Error('انتهت الجلسة المركزية؛ سجّل الدخول مجدداً.');
    const prepared: Record<string, unknown> = { ...record, schoolId: session.user.schoolId };
    if ((entity === 'visits' || entity === 'plans') && session.user.role === 'evaluator') {
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
}
