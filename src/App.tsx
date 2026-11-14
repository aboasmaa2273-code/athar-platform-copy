import React, { useState, useEffect } from 'react';
import { 
  User, 
  Teacher, 
  ClassroomVisit, 
  ImprovementPlan, 
  AcademicSettings, 
  PlatformSettings,
  AuditLogEntry
} from './types';
import { AtharStorageService } from './services/storageService';
import { CentralDataRepository } from './services/centralDataRepository';
import { Header } from './components/Header';
import { PublicHome } from './components/PublicHome';
import { Dashboard } from './components/Dashboard';
import { AdvancedAnalyticsDashboard } from './components/AdvancedAnalyticsDashboard';
import { TeachersList } from './components/TeachersList';
import { VisitsList } from './components/VisitsList';
import { VisitForm } from './components/VisitForm';
import { VisitReportModal } from './components/VisitReportModal';
import { TeacherReportView } from './components/TeacherReportView';
import { ImprovementPlansList } from './components/ImprovementPlansList';
import { AcademicSettingsView } from './components/AcademicSettingsView';
import { PlatformSettingsView } from './components/PlatformSettingsView';
import { GasIntegrationHub } from './components/GasIntegrationHub';
import { ReportsView } from './components/ReportsView';
import { LoginModal } from './components/LoginModal';
import { 
  Shield, 
  CheckCircle, 
  UserCheck, 
  X, 
  Sparkles,
  School,
  Database
} from 'lucide-react';
import { translations, Language } from './i18n/translations';

export default function App() {
  // Language State with persistence
  const [language, setLanguage] = useState<Language>(() => {
    return (localStorage.getItem('athar_language_pref') as Language) || 'ar';
  });

  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    localStorage.setItem('athar_language_pref', language);
  }, [language]);

  // Authentication & Current User - Defaults to logged-out on start to open on the Public Homepage
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<User>(() => AtharStorageService.getCurrentUser());
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);

  // Active Navigation Tab - Starts on the Home page with the hero picture
  const [activeTab, setActiveTab] = useState<string>('home');

  // Application Data State
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [visits, setVisits] = useState<ClassroomVisit[]>([]);
  const [plans, setPlans] = useState<ImprovementPlan[]>([]);
  const [academicSettings, setAcademicSettings] = useState<AcademicSettings>(() => AtharStorageService.getAcademicSettings());
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(() => AtharStorageService.getPlatformSettings());
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [dataSyncError, setDataSyncError] = useState('');

  const centralSessionMatches = CentralDataRepository.matchesAppUser(currentUser);
  const appUser = centralSessionMatches && CentralDataRepository.getSignedInUser()
    ? { ...currentUser, id: CentralDataRepository.getSignedInUser()!.userId, schoolId: CentralDataRepository.getSignedInUser()!.schoolId }
    : currentUser;

  // Selected sub-views state
  const [selectedVisitForReport, setSelectedVisitForReport] = useState<ClassroomVisit | null>(null);
  const [selectedTeacherForReport, setSelectedTeacherForReport] = useState<Teacher | null>(null);
  const [editingVisit, setEditingVisit] = useState<ClassroomVisit | null>(null);

  // Central reads are used only when the active server session matches the app identity.
  // A failed central read never falls back silently to stale local records.
  const refreshAllData = async (requestedUser: User = currentUser) => {
    if (CentralDataRepository.isReady()) {
      if (!CentralDataRepository.matchesAppUser(requestedUser)) {
        setDataSyncError('الجلسة المركزية الحالية لا تطابق المستخدم المفتوح في المنصة. لم نخلط بيانات الحسابين؛ تحقق من الحسابين قبل المتابعة.');
        return;
      }
      const loaded = await CentralDataRepository.loadSnapshot();
      if (!loaded.success) {
        setDataSyncError(loaded.error);
        return;
      }
      setTeachers(loaded.data.teachers);
      setVisits(loaded.data.visits);
      setPlans(loaded.data.plans);
      setAcademicSettings(AtharStorageService.getAcademicSettings());
      setPlatformSettings(AtharStorageService.getPlatformSettings());
      if (['platform_admin', 'school_admin', 'vice_principal'].includes(requestedUser.role)) {
        const audit = await CentralDataRepository.loadAuditLogs();
        setAuditLogs(audit.success ? audit.records : []);
      } else {
        setAuditLogs([]);
      }
      setDataSyncError('');
      return;
    }
    setTeachers(AtharStorageService.getTeachers());
    setVisits(AtharStorageService.getVisits());
    setPlans(AtharStorageService.getPlans());
    setAcademicSettings(AtharStorageService.getAcademicSettings());
    setPlatformSettings(AtharStorageService.getPlatformSettings());
    setAuditLogs(AtharStorageService.getAuditLogs());
    setDataSyncError('');
  };

  useEffect(() => {
    void refreshAllData();
  }, []);

  // Re-read central data when returning from the integration hub after central sign-in.
  useEffect(() => {
    if (isLoggedIn && activeTab !== 'gas-hub') void refreshAllData(currentUser);
  }, [activeTab, isLoggedIn, currentUser]);

  // Handle user switch
  const handleUserChange = (newUser: User) => {
    AtharStorageService.setCurrentUser(newUser);
    setCurrentUser(newUser);
    void refreshAllData(newUser);
    // If switched to teacher, make sure they aren't on admin-only tabs
    if (newUser.role === 'teacher' && ['settings', 'new-visit'].includes(activeTab)) {
      setActiveTab('dashboard');
    }
  };

  // Login handler
  const handleSelectRoleToLogin = (user: User) => {
    handleUserChange(user);
    setIsLoggedIn(true);
    setIsLoginModalOpen(false);
    setActiveTab('dashboard');
  };

  // Logout handler
  const handleLogout = () => {
    setIsLoggedIn(false);
    setActiveTab('home');
  };

  // Navigation router
  const handleNavigate = (tab: string, param?: any) => {
    if (tab === 'new-visit') {
      setEditingVisit(null);
    }
    setActiveTab(tab);
  };

  return (
    <div 
      className={`min-h-screen bg-[#F2EBDD]/20 text-[#172C40] flex flex-col ${language === 'ar' ? "font-['Cairo',sans-serif]" : "font-sans"}`} 
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      
      {/* Top Header */}
      <Header
        currentUser={appUser}
        onUserChange={handleUserChange}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        platformSettings={platformSettings}
        isLoggedIn={isLoggedIn}
        onLoginClick={() => setIsLoginModalOpen(true)}
        onLogoutClick={handleLogout}
        language={language}
        onLanguageChange={setLanguage}
      />

      {/* Main Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {dataSyncError && isLoggedIn && (
          <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {dataSyncError}
          </div>
        )}
        
        {/* View 1: Public Homepage */}
        {(!isLoggedIn || activeTab === 'home') && (
          <PublicHome
            platformSettings={platformSettings}
            onLoginClick={() => setIsLoginModalOpen(true)}
            onSelectEvaluator={(user, destination) => {
              handleUserChange(user);
              setIsLoggedIn(true);
              if (destination === 'new-visit') {
                setEditingVisit(null);
                setActiveTab('new-visit');
              } else {
                setActiveTab('dashboard');
              }
            }}
            language={language}
          />
        )}

        {/* When Logged In: Core Educational Modules */}
        {isLoggedIn && activeTab === 'dashboard' && (
          <Dashboard
            currentUser={appUser}
            visits={visits}
            teachers={teachers}
            plans={plans}
            onNavigate={handleNavigate}
            onOpenVisitReport={(v) => setSelectedVisitForReport(v)}
            language={language}
          />
        )}

        {isLoggedIn && activeTab === 'analytics' && ['school_admin', 'platform_admin', 'vice_principal'].includes(currentUser.role) && (
          <AdvancedAnalyticsDashboard
            currentUser={appUser}
            visits={visits}
            teachers={teachers}
            plans={plans}
            auditLogs={auditLogs}
            onOpenVisitReport={(v) => setSelectedVisitForReport(v)}
            onDeleteRecords={(visitIds, planIds) => {
              const visitResult = AtharStorageService.deleteSelectedVisits(visitIds);
              if (!visitResult.success) return { success: false, visitsDeleted: 0, plansDeleted: 0, error: visitResult.error };
              const planResult = AtharStorageService.deleteSelectedPlans(planIds);
              if (!planResult.success) {
                refreshAllData();
                return { success: false, visitsDeleted: visitResult.count, plansDeleted: 0, error: planResult.error };
              }
              refreshAllData();
              return { success: true, visitsDeleted: visitResult.count, plansDeleted: planResult.count };
            }}
          />
        )}

        {isLoggedIn && activeTab === 'teachers' && (
          <TeachersList
            teachers={teachers}
            currentUser={appUser}
            onRefreshTeachers={() => { void refreshAllData(appUser); }}
            onSaveTeacher={async (teacher) => {
              if (!centralSessionMatches) return AtharStorageService.saveTeacher(teacher);
              const record: Teacher = {
                ...teacher,
                id: teacher.id || `tch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                schoolId: appUser.schoolId,
                dateAdded: teacher.id ? (teachers.find(t => t.id === teacher.id)?.dateAdded || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10)
              };
              const result = await CentralDataRepository.saveTeacher(record);
              if (result.success) await refreshAllData(appUser);
              return result;
            }}
            onToggleTeacherStatus={async (id) => {
              if (!centralSessionMatches) {
                const result = AtharStorageService.toggleTeacherStatus(id);
                return result;
              }
              const teacher = teachers.find(t => t.id === id);
              if (!teacher) return { success: false, error: 'المعلم غير موجود في السجل المركزي.' };
              const result = await CentralDataRepository.setTeacherStatus(teacher, teacher.status === 'active' ? 'inactive' : 'active');
              if (result.success) await refreshAllData(appUser);
              return result;
            }}
            onDeleteTeacher={async (id) => {
              if (!centralSessionMatches) return AtharStorageService.deleteTeacher(id);
              const result = await CentralDataRepository.deleteTeacher(id);
              if (result.success) await refreshAllData(appUser);
              return result;
            }}
            onImportTeachers={async (rows) => {
              if (!centralSessionMatches) {
                const result = AtharStorageService.bulkImportTeachers(rows);
                return { importedCount: result.importedCount, rejectedCount: result.rejectedCount, errors: result.errors };
              }
              const records: Teacher[] = rows.map((row, index) => ({
                ...row,
                id: `tch_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
                schoolId: appUser.schoolId,
                status: 'active',
                dateAdded: new Date().toISOString().slice(0, 10)
              }));
              const result = await CentralDataRepository.importTeachers(records);
              if (result.success) await refreshAllData(appUser);
              return { importedCount: result.imported, rejectedCount: result.success ? 0 : records.length - result.imported, errors: result.error ? [result.error] : [] };
            }}
            onOpenTeacherReport={(teacher) => {
              setSelectedTeacherForReport(teacher);
              setActiveTab('teacher-report');
            }}
            language={language}
          />
        )}

        {isLoggedIn && activeTab === 'visits' && (
          <VisitsList
            visits={visits}
            currentUser={appUser}
            onOpenReport={(v) => setSelectedVisitForReport(v)}
            onEditVisit={(v) => {
              setEditingVisit(v);
              setActiveTab('new-visit');
            }}
            onCreateNewVisit={() => {
              setEditingVisit(null);
              setActiveTab('new-visit');
            }}
            onRefreshVisits={refreshAllData}
            language={language}
          />
        )}

        {isLoggedIn && activeTab === 'new-visit' && (
          <VisitForm
            currentUser={currentUser}
            teachers={teachers}
            academicSettings={academicSettings}
            editingVisit={editingVisit}
            onSaveVisit={async (visit) => {
              if (!centralSessionMatches) {
                const local = AtharStorageService.saveVisit(visit);
                return { success: local.success, visit: local.visit, error: local.error };
              }
              const result = await CentralDataRepository.saveVisit(visit);
              return { success: result.success, visit: result.success ? visit : undefined, error: result.error };
            }}
            onSaveSuccess={(saved) => {
              refreshAllData();
              setSelectedVisitForReport(saved);
              setActiveTab('visits');
            }}
            onCancel={() => setActiveTab('visits')}
            language={language}
          />
        )}

        {isLoggedIn && activeTab === 'plans' && (
          <ImprovementPlansList
            plans={plans}
            teachers={teachers}
            currentUser={currentUser}
            onRefreshPlans={() => { void refreshAllData(appUser); }}
            onSavePlan={async (plan) => {
              if (!centralSessionMatches) return AtharStorageService.savePlan(plan);
              const record: ImprovementPlan = {
                ...plan,
                id: plan.id || `PLN-${new Date().getFullYear()}-${Date.now()}`,
                createdAt: new Date().toISOString(),
                schoolId: appUser.schoolId
              };
              const result = await CentralDataRepository.savePlan(record);
              if (result.success) await refreshAllData(appUser);
              return result;
            }}
            onUpdatePlanFollowUp={async (plan, changes) => {
              if (!centralSessionMatches) return AtharStorageService.updatePlanFollowUp(plan.id, changes);
              const result = await CentralDataRepository.updatePlanFollowUp(plan, changes);
              if (result.success) await refreshAllData(appUser);
              return result;
            }}
            language={language}
          />
        )}

        {isLoggedIn && activeTab === 'reports' && (
          <ReportsView
            visits={visits}
            teachers={teachers}
            plans={plans}
            platformSettings={platformSettings}
            onOpenVisitReport={(v) => setSelectedVisitForReport(v)}
            onOpenTeacherReport={(t) => {
              setSelectedTeacherForReport(t);
              setActiveTab('teacher-report');
            }}
            language={language}
          />
        )}

        {isLoggedIn && activeTab === 'teacher-report' && selectedTeacherForReport && (
          <TeacherReportView
            teacher={selectedTeacherForReport}
            visits={visits}
            plans={plans}
            platformSettings={platformSettings}
            onBack={() => setActiveTab('teachers')}
            onOpenVisitReport={(v) => setSelectedVisitForReport(v)}
            language={language}
          />
        )}

        {isLoggedIn && activeTab === 'gas-hub' && (
          <GasIntegrationHub language={language} />
        )}

        {isLoggedIn && activeTab === 'settings' && (
          <div className="space-y-8">
            <PlatformSettingsView
              settings={platformSettings}
              currentUser={currentUser}
              auditLogs={auditLogs}
              onRefreshSettings={refreshAllData}
              language={language}
            />
            <AcademicSettingsView
              settings={academicSettings}
              currentUser={currentUser}
              onRefreshSettings={refreshAllData}
              language={language}
            />
          </div>
        )}

      </main>

      {/* Official Printable Visit Report Modal */}
      {selectedVisitForReport && (
        <VisitReportModal
          visit={selectedVisitForReport}
          platformSettings={platformSettings}
          onClose={() => setSelectedVisitForReport(null)}
          language={language}
          canDelete={currentUser.role !== 'teacher'}
          onDeleteReport={(visitId) => {
            const res = AtharStorageService.deleteVisit(visitId);
            if (res.success) {
              refreshAllData();
            } else {
              alert(res.error);
            }
          }}
        />
      )}

      {/* Username & Password Login Modal */}
      {isLoginModalOpen && (
        <LoginModal
          isOpen={isLoginModalOpen}
          onClose={() => setIsLoginModalOpen(false)}
          onLoginSuccess={(user) => {
            handleUserChange(user);
            setIsLoggedIn(true);
            setIsLoginModalOpen(false);
            setActiveTab('dashboard');
          }}
          language={language}
        />
      )}

      {/* Footer (No telemetry, clean institutional branding) */}
      <footer className="no-print bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>{language === 'ar' ? `${platformSettings.platformName} — ${platformSettings.platformTitle}` : `${translations.en.platformName} — ${translations.en.platformTitle}`}</span>
          <span className="text-[#C6A66A] font-bold">{language === 'ar' ? platformSettings.slogan : translations.en.slogan}</span>
          <span>{language === 'ar' ? platformSettings.schoolName : translations.en.schoolName}</span>
        </div>
      </footer>

    </div>
  );
}
