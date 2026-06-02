'use client';

import { useState, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Upload, CheckCircle2, AlertTriangle, FileSpreadsheet, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import {
  saveTenant, saveLease, saveBilling, writeAudit,
} from '@/lib/data';
import { makeTenantId, makeLeaseId } from '@/lib/codes';
import { fmtDate } from '@/lib/utils';
import type { Tenant, Lease, Billing } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ParsedRow {
  name: string;
  biz_no: string;
  ceo: string;
  phone: string;
  officeCodes: string[];      // 호수 코드들 (콤마 구분)
  sectionCodes: string[];     // 블럭 코드들 (콤마 구분)
  start: string;
  end: string;
  rentTotal: number;
  maintTotal: number;
  deposit: number;
  arrears: number;
  // 검증 결과
  errors: string[];
  tenantId?: string;
  resolvedOfficeIds?: string[];
  resolvedSectionIds?: string[];
  needsTenantCreate?: boolean;
}

export function MigrationDialog({ open, onClose }: Props) {
  const { tenants, stalls, sections, today } = useData();
  const { user } = useAuth();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const sample = [
      {
        '상사명': '○○모터스',
        '사업자번호': '124-86-12345',
        '대표': '홍길동',
        '전화': '010-1111-2222',
        '사무실호수': 'A-201',
        '블럭코드': 'SEC-A1',
        '시작일': '2025-08-01',
        '종료일': '2026-07-31',
        '월세': 3050000,
        '관리비': 350000,
        '보증금': 18300000,
        '이월미수금': 0,
      },
      {
        '상사명': '△△오토',
        '사업자번호': '215-87-22221',
        '대표': '김대표',
        '전화': '010-2222-3333',
        '사무실호수': 'A-202',
        '블럭코드': 'SEC-A2',
        '시작일': '2025-09-01',
        '종료일': '2026-08-31',
        '월세': 3050000,
        '관리비': 350000,
        '보증금': 18300000,
        '이월미수금': 1500000,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    ws['!cols'] = [
      { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 15 }, { wch: 18 }, { wch: 18 },
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '임대현황+미수');
    XLSX.writeFile(wb, '임대현황_미수_마이그레이션양식.xlsx');
    toast.success('양식 다운로드 완료');
  }

  async function handleFile(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const json: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

      const get = (r: any, keys: string[]) => {
        for (const k of keys) {
          for (const rk of Object.keys(r)) {
            if (rk.replace(/\s/g, '').includes(k)) return String(r[rk] || '').trim();
          }
        }
        return '';
      };
      const getNum = (r: any, keys: string[]) => {
        const v = get(r, keys);
        if (!v) return 0;
        return parseInt(v.replace(/[,\s원]/g, '')) || 0;
      };
      const splitCodes = (s: string) =>
        s.split(/[,\s/]+/).map((x) => x.trim()).filter(Boolean);

      const parsed: ParsedRow[] = json.map((r) => {
        const name = get(r, ['상사명', '회사명', '상호']);
        const biz_no = get(r, ['사업자번호']);
        const ceo = get(r, ['대표']);
        const phone = get(r, ['전화', '연락처']);
        const officeStr = get(r, ['사무실호수', '호수', '사무실']);
        const sectionStr = get(r, ['블럭코드', '블럭', '전시장']);
        const start = get(r, ['시작일']);
        const end = get(r, ['종료일']);
        const rentTotal = getNum(r, ['월세', '임대료']);
        const maintTotal = getNum(r, ['관리비']);
        const deposit = getNum(r, ['보증금']);
        const arrears = getNum(r, ['이월미수금', '미수금', '미수']);

        const officeCodes = splitCodes(officeStr);
        const sectionCodes = splitCodes(sectionStr);

        const errors: string[] = [];
        if (!name) errors.push('상사명 없음');
        if (!start || !end) errors.push('계약 기간 없음');

        // 호수 매칭
        const resolvedOfficeIds: string[] = [];
        for (const code of officeCodes) {
          const s = stalls.find((x) => x.id === code || x.code === code);
          if (s && s.type === 'office') resolvedOfficeIds.push(s.id);
          else errors.push(`사무실 호수 ${code} 없음`);
        }
        // 블럭 매칭
        const resolvedSectionIds: string[] = [];
        for (const code of sectionCodes) {
          const sec = sections.find((x) => x.id === code || x.code === code || x.name === code);
          if (sec) resolvedSectionIds.push(sec.id);
          else errors.push(`블럭 ${code} 없음`);
        }
        // 상사 매칭 (이름 또는 사업자번호)
        const existing = tenants.find((t) => t.name === name || (biz_no && t.biz_no === biz_no));

        return {
          name, biz_no, ceo, phone,
          officeCodes, sectionCodes,
          start, end,
          rentTotal, maintTotal, deposit, arrears,
          errors,
          tenantId: existing?.id,
          resolvedOfficeIds,
          resolvedSectionIds,
          needsTenantCreate: !existing,
        };
      }).filter((r) => r.name);

      if (parsed.length === 0) {
        toast.error('읽어낸 행이 없습니다');
        return;
      }
      setRows(parsed);
      setStep('review');
    } catch (e: any) {
      toast.error(e?.message || '파일 읽기 실패');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const validRows = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);
  const errorRows = useMemo(() => rows.filter((r) => r.errors.length > 0), [rows]);
  const totalArrears = useMemo(() => validRows.reduce((s, r) => s + r.arrears, 0), [validRows]);

  async function submit() {
    if (validRows.length === 0) {
      toast.error('등록 가능한 행이 없습니다');
      return;
    }
    setSubmitting(true);
    try {
      let createdTenants = 0;
      let createdLeases = 0;
      let createdArrearsBills = 0;

      for (const r of validRows) {
        let tenantId = r.tenantId;
        if (!tenantId) {
          const t: Tenant = {
            id: makeTenantId(),
            name: r.name,
            biz_no: r.biz_no,
            ceo: r.ceo,
            phone: r.phone,
            deposit_paid: r.deposit,
          };
          await saveTenant(t);
          tenantId = t.id;
          createdTenants++;
        }

        // section의 stall들 다 모음
        const sectionStallIds: string[] = [];
        for (const sid of r.resolvedSectionIds || []) {
          const sectionStalls = stalls.filter((s) => s.section_id === sid);
          sectionStallIds.push(...sectionStalls.map((s) => s.id));
        }
        const allStallIds = Array.from(new Set([
          ...(r.resolvedOfficeIds || []),
          ...sectionStallIds,
        ]));

        const lease: Lease = {
          id: makeLeaseId(),
          tenant_id: tenantId,
          office_stall_ids: r.resolvedOfficeIds || [],
          section_ids: r.resolvedSectionIds || [],
          stall_ids: allStallIds,
          start: r.start,
          end: r.end,
          rent_total: r.rentTotal,
          maint_total: r.maintTotal,
          deposit: r.deposit,
          status: 'active',
          signed_at: r.start,
        };
        await saveLease(lease);
        createdLeases++;

        // 이월 미수금 → 'open' 청구로 등록
        if (r.arrears > 0) {
          const b: Billing = {
            id: `BL_OPEN_${lease.id}`,
            lease_id: lease.id,
            tenant_id: tenantId,
            period: 'open',
            items: [{ type: '이월 미수금', amount: r.arrears }],
            total: r.arrears,
            due_date: fmtDate(today),
            paid_amount: 0,
          };
          await saveBilling(b);
          createdArrearsBills++;
        }
      }

      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'migration_upload',
        target: `${validRows.length}건`,
        memo: `초기 마이그레이션 — 상사 ${createdTenants} · 계약 ${createdLeases} · 이월미수 ${createdArrearsBills}`,
        at: fmtDate(today),
      });
      toast.success(`마이그레이션 완료 — 상사 ${createdTenants} · 계약 ${createdLeases} · 이월미수 ${createdArrearsBills}건`);
      setRows([]);
      setStep('upload');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally { setSubmitting(false); }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="임대 현황·미수금 일괄 마이그레이션"
      desc={step === 'upload' ? '엑셀 양식 — 상사 · 계약 · 이월 미수금 한 번에' : '검증 결과 확인 후 등록'}
      width={920}
      footer={
        step === 'upload' ? (
          <Button variant="ghost" onClick={onClose}>취소</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => { setStep('upload'); setRows([]); }}>← 다시 올리기</Button>
            <Button variant="primary" onClick={submit} disabled={submitting || validRows.length === 0}>
              {submitting ? '등록 중...' : `${validRows.length}건 등록 (이월 미수 ${totalArrears.toLocaleString()}원)`}
            </Button>
          </>
        )
      }
    >
      {step === 'upload' ? (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 flex items-center gap-3">
            <Download className="w-5 h-5 text-amber-700 shrink-0" />
            <div className="flex-1 text-[12.5px]">
              <div className="font-semibold text-amber-900">1️⃣ 양식 다운로드</div>
              <div className="text-[11px] text-amber-700 mt-0.5">
                컬럼: 상사명 · 사업자번호 · 대표 · 전화 · 사무실호수 · 블럭코드 · 시작일 · 종료일 · 월세 · 관리비 · 보증금 · 이월미수금
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="w-3.5 h-3.5" /> 양식 다운로드
            </Button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="font-semibold text-blue-900 mb-2 text-[13px]">2️⃣ 채워진 엑셀 파일 올리기</div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              className="hidden" />
            <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
              <FileSpreadsheet className="w-4 h-4" /> 엑셀 파일 선택
            </Button>
            <ul className="text-[11px] text-blue-700 mt-3 space-y-0.5 list-disc list-inside">
              <li>상사명 기준으로 기존 상사 자동 매칭 (없으면 자동 생성)</li>
              <li>사무실/블럭 코드는 단지 도면에 이미 존재해야 함</li>
              <li>이월미수금은 'open' 기간의 청구서로 등록되어 미수 관리에 즉시 반영</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="전체" value={`${rows.length}행`} />
            <Stat label="등록 예정" value={`${validRows.length}건`} tone="success" />
            <Stat label="오류 (제외)" value={`${errorRows.length}건`} tone="warn" />
            <Stat label="이월 미수 합계" value={`${totalArrears.toLocaleString()}원`} tone={totalArrears > 0 ? 'danger' : 'muted'} />
          </div>
          <div className="border border-zinc-200 rounded-md overflow-hidden">
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-zinc-50 border-b border-zinc-200 z-10">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-semibold">상사</th>
                    <th className="text-left px-2 py-1.5 font-semibold">사무실</th>
                    <th className="text-left px-2 py-1.5 font-semibold">블럭</th>
                    <th className="text-center px-2 py-1.5 font-semibold whitespace-nowrap">기간</th>
                    <th className="text-right px-2 py-1.5 font-semibold whitespace-nowrap">월 합계</th>
                    <th className="text-right px-2 py-1.5 font-semibold whitespace-nowrap">이월미수</th>
                    <th className="text-center px-2 py-1.5 font-semibold">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b border-zinc-100 ${r.errors.length > 0 ? 'bg-red-50/40' : ''}`}>
                      <td className="px-2 py-1 font-medium">
                        <div>{r.name}</div>
                        <div className="text-[10px] text-zinc-500 tabular">{r.biz_no}</div>
                      </td>
                      <td className="px-2 py-1 text-[10.5px] text-zinc-700">{r.officeCodes.join(', ') || '—'}</td>
                      <td className="px-2 py-1 text-[10.5px] text-zinc-700">{r.sectionCodes.join(', ') || '—'}</td>
                      <td className="px-2 py-1 text-center tabular text-[10.5px] text-zinc-600 whitespace-nowrap">
                        {r.start}<br /><span className="text-zinc-400">~ {r.end}</span>
                      </td>
                      <td className="px-2 py-1 text-right tabular">{(r.rentTotal + r.maintTotal).toLocaleString()}</td>
                      <td className={`px-2 py-1 text-right tabular ${r.arrears > 0 ? 'text-red-600 font-bold' : 'text-zinc-400'}`}>
                        {r.arrears.toLocaleString()}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {r.errors.length === 0 ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600 inline" />
                        ) : (
                          <span title={r.errors.join(' · ')} className="inline-flex items-center gap-0.5 text-amber-700 text-[10px]">
                            <AlertTriangle className="w-3 h-3" /> {r.errors.length}개
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {errorRows.length > 0 && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              ⚠ 오류 행은 등록되지 않습니다. 양식 수정 후 다시 올리세요. (호수·블럭 코드는 단지 도면에 미리 등록 필요)
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warn' | 'danger' | 'muted' }) {
  const color =
    tone === 'success' ? 'text-green-700'
    : tone === 'warn' ? 'text-amber-700'
    : tone === 'danger' ? 'text-red-600'
    : tone === 'muted' ? 'text-zinc-500'
    : 'text-zinc-900';
  return (
    <div className="bg-zinc-50 rounded-md border border-zinc-200 p-2.5">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[14px] font-bold mt-0.5 tabular ${color}`}>{value}</div>
    </div>
  );
}
