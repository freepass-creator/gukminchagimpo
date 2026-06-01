'use client';

import { useState, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, AlertCircle, FileSpreadsheet, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveLease, saveTenant, writeAudit } from '@/lib/data';
import { makeLeaseId, makeTenantId } from '@/lib/codes';
import { fmtDate, fmtMoney } from '@/lib/utils';
import type { Lease, Tenant } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ParsedLease {
  rowIdx: number;
  tenantName: string;
  officeCodes: string[];      // ['A-201']
  sectionCodes: string[];     // ['B01']
  start: string;
  end: string;
  rent: number;
  maint: number;
  deposit: number;
  // 검증 결과
  tenantMatched: Tenant | null;
  willCreateTenant: boolean;
  resolvedOfficeStallIds: string[];
  resolvedSectionIds: string[];
  errors: string[];
}

export function LeaseUploadDialog({ open, onClose }: Props) {
  const { tenants, stalls, sections, config, today } = useData();
  const { user } = useAuth();
  const [rows, setRows] = useState<ParsedLease[]>([]);
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const data = [
      {
        '상사명': '○○모터스',
        '사무실호수': 'A-201',
        '블럭코드': 'B01',
        '시작일': '2026-08-01',
        '종료일': '2027-07-31',
        '월세': 3050000,
        '관리비': 350000,
        '보증금': 18300000,
      },
      {
        '상사명': '△△오토',
        '사무실호수': 'B-301, B-302',
        '블럭코드': 'B07',
        '시작일': '2026-09-01',
        '종료일': '2027-08-31',
        '월세': 5400000,
        '관리비': 590000,
        '보증금': 32400000,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 14 }, { wch: 20 }, { wch: 14 },
      { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 10 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '임대계약');
    XLSX.writeFile(wb, '임대계약_업로드양식.xlsx');
    toast.success('양식 다운로드 완료 — 채워서 다시 올려주세요');
  }

  async function handleFile(file: File) {
    try {
      const name = file.name.toLowerCase();
      let json: any[] = [];
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      } else {
        toast.error('엑셀 파일을 올려주세요');
        return;
      }

      const get = (r: any, keys: string[]) => {
        for (const k of keys) {
          for (const rk of Object.keys(r)) {
            if (rk.replace(/\s/g, '').includes(k)) return String(r[rk] ?? '').trim();
          }
        }
        return '';
      };
      const getNum = (r: any, keys: string[]) => {
        const s = get(r, keys).replace(/[,\s원]/g, '');
        return parseInt(s) || 0;
      };

      const parsed: ParsedLease[] = json.map((r, idx) => {
        const tenantName = get(r, ['상사명', '입주상사', '법인명', '회사명']);
        const officeStr = get(r, ['사무실', '호수', '사무실호수', '사무실코드']);
        const sectionStr = get(r, ['블럭', '블럭코드', '주차블럭', '섹션']);
        const start = get(r, ['시작일', '시작', '계약시작', 'startdate']);
        const end = get(r, ['종료일', '종료', '계약종료', 'enddate']);
        const rent = getNum(r, ['월세', '임대료', 'rent']);
        const maint = getNum(r, ['관리비', 'maint']);
        const deposit = getNum(r, ['보증금', 'deposit']);

        const officeCodes = officeStr.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
        const sectionCodes = sectionStr.split(/[,/]/).map((s) => s.trim()).filter(Boolean);

        const tenantMatched = tenants.find((t) =>
          t.name.replace(/\s/g, '') === tenantName.replace(/\s/g, '')
        ) || null;
        const willCreateTenant = !tenantMatched && tenantName.length > 0;

        const resolvedOfficeStallIds: string[] = [];
        const errors: string[] = [];
        for (const code of officeCodes) {
          const stall = stalls.find((s) => s.id === code || (`${s.building}-${s.code}` === code));
          if (!stall) errors.push(`사무실 ${code} 찾을 수 없음`);
          else if (stall.type !== 'office') errors.push(`${code}는 사무실 아님`);
          else resolvedOfficeStallIds.push(stall.id);
        }
        const resolvedSectionIds: string[] = [];
        for (const code of sectionCodes) {
          const sec = sections.find((s) => s.code === code);
          if (!sec) errors.push(`블럭 ${code} 찾을 수 없음`);
          else resolvedSectionIds.push(sec.id);
        }

        if (!tenantName) errors.push('상사명 비어 있음');
        if (!start || !end) errors.push('기간 비어 있음');
        else if (end <= start) errors.push('종료일 ≤ 시작일');
        if (officeCodes.length === 0 && sectionCodes.length === 0)
          errors.push('사무실/블럭 둘 다 비어 있음');

        return {
          rowIdx: idx + 1,
          tenantName, officeCodes, sectionCodes,
          start: normalizeDate(start), end: normalizeDate(end),
          rent, maint, deposit,
          tenantMatched, willCreateTenant,
          resolvedOfficeStallIds, resolvedSectionIds,
          errors,
        };
      }).filter((r) => r.tenantName || r.officeCodes.length > 0);

      if (parsed.length === 0) {
        toast.error('읽어낸 계약 정보가 없습니다');
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
  const errCount = rows.length - validRows.length;

  async function submit() {
    if (validRows.length === 0) { toast.error('등록 가능한 항목이 없습니다'); return; }
    setSubmitting(true);
    try {
      for (const r of validRows) {
        let tid: string;
        if (r.tenantMatched) tid = r.tenantMatched.id;
        else {
          tid = makeTenantId();
          const t: Tenant = {
            id: tid, name: r.tenantName, biz_no: '', ceo: '', phone: '', deposit_paid: 0,
          };
          await saveTenant(t);
        }
        // 블럭에 속한 stall_id들 펼치기
        const sectionStalls: string[] = [];
        for (const secId of r.resolvedSectionIds) {
          stalls.filter((s) => s.section_id === secId).forEach((s) => sectionStalls.push(s.id));
        }
        const lease: Lease = {
          id: makeLeaseId(),
          tenant_id: tid,
          stall_ids: [...r.resolvedOfficeStallIds, ...sectionStalls],
          office_stall_ids: r.resolvedOfficeStallIds,
          section_ids: r.resolvedSectionIds.length > 0 ? r.resolvedSectionIds : undefined,
          start: r.start, end: r.end,
          rent_total: r.rent, maint_total: r.maint, deposit: r.deposit,
          status: 'active',
          signed_at: fmtDate(today),
        };
        await saveLease(lease);
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'lease_bulk_upload',
        target: `${validRows.length}건`,
        memo: `임대계약 엑셀 일괄 등록 ${validRows.length}건 (오류 ${errCount} 제외)`,
        at: fmtDate(today),
      });
      toast.success(`${validRows.length}건 계약 등록 완료`);
      setRows([]); setStep('upload');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally { setSubmitting(false); }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="임대 계약 엑셀로 한 번에 등록"
      desc={step === 'upload' ? '엑셀 컬럼: 상사명·사무실호수·블럭코드·시작·종료·월세·관리비·보증금' : '검증 결과 확인 후 등록'}
      width={1000}
      footer={
        step === 'upload' ? (
          <Button variant="ghost" onClick={onClose}>취소</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('upload')}>← 다시 올리기</Button>
            <Button variant="primary" onClick={submit} disabled={submitting || validRows.length === 0}>
              {submitting ? '등록 중...' : `${validRows.length}건 등록`}
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
              <div className="font-semibold text-amber-900">1️⃣ 양식 다운로드 → 채우기 → 업로드</div>
              <div className="text-[11px] text-amber-700 mt-0.5">
                사무실 코드(A-201), 블럭 코드(B01)는 도면 만들기에서 확인 가능
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="w-3.5 h-3.5" /> 양식 다운로드
            </Button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="font-semibold text-blue-900 mb-2 text-[13px]">2️⃣ 엑셀 파일 올리기</div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              className="hidden" />
            <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
              <FileSpreadsheet className="w-4 h-4" /> 엑셀 파일 선택
            </Button>
            <div className="text-[11px] text-blue-700 mt-2">
              · 상사명이 기존에 없으면 자동 신규 등록<br />
              · 사무실/블럭 코드가 잘못되면 오류로 표시되고 등록 안 됨
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="전체" value={`${rows.length}건`} />
            <Stat label="등록 예정" value={`${validRows.length}건`} tone="success" />
            <Stat label="오류" value={`${errCount}건`} tone="error" />
          </div>
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <div className="max-h-[380px] overflow-y-auto">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-zinc-50 z-10 border-b-2 border-zinc-200">
                  <tr>
                    <th className="text-left px-2.5 py-2 font-semibold">#</th>
                    <th className="text-left px-2.5 py-2 font-semibold">상사</th>
                    <th className="text-left px-2.5 py-2 font-semibold">사무실</th>
                    <th className="text-left px-2.5 py-2 font-semibold">블럭</th>
                    <th className="text-center px-2.5 py-2 font-semibold">기간</th>
                    <th className="text-right px-2.5 py-2 font-semibold">월세</th>
                    <th className="text-right px-2.5 py-2 font-semibold">보증금</th>
                    <th className="text-center px-2.5 py-2 font-semibold">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const ok = r.errors.length === 0;
                    return (
                      <tr key={r.rowIdx} className={`border-b border-zinc-100 ${ok ? '' : 'bg-red-50/50'}`}>
                        <td className="px-2.5 py-1.5 text-zinc-500">{r.rowIdx}</td>
                        <td className="px-2.5 py-1.5">
                          {r.tenantName}
                          {r.willCreateTenant && <span className="ml-1 text-[10px] text-blue-600">(신규)</span>}
                        </td>
                        <td className="px-2.5 py-1.5 text-zinc-600">{r.officeCodes.join(', ') || '—'}</td>
                        <td className="px-2.5 py-1.5 text-zinc-600">{r.sectionCodes.join(', ') || '—'}</td>
                        <td className="px-2.5 py-1.5 text-center tabular text-[10.5px]">{r.start}<br />~ {r.end}</td>
                        <td className="px-2.5 py-1.5 text-right tabular">{fmtMoney(r.rent)}</td>
                        <td className="px-2.5 py-1.5 text-right tabular">{fmtMoney(r.deposit)}</td>
                        <td className="px-2.5 py-1.5 text-center">
                          {ok ? <CheckCircle2 className="w-4 h-4 text-green-600 inline" /> : (
                            <span title={r.errors.join(', ')} className="text-[10px] text-red-700">
                              <AlertCircle className="w-4 h-4 inline mr-0.5" />{r.errors.length}건
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {errCount > 0 && (
            <details className="bg-red-50 border border-red-200 rounded-md p-3 text-[11.5px]">
              <summary className="cursor-pointer font-semibold text-red-900">오류 상세 ({errCount}건)</summary>
              <ul className="mt-2 space-y-0.5 text-red-800">
                {rows.filter((r) => r.errors.length > 0).map((r) => (
                  <li key={r.rowIdx}>· {r.rowIdx}행 ({r.tenantName}): {r.errors.join(' / ')}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

function normalizeDate(s: string): string {
  if (!s) return '';
  // Excel serial?
  if (/^\d+$/.test(s) && parseInt(s) > 30000) {
    const d = XLSX.SSF.parse_date_code(parseInt(s));
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  // YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const m = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'error' }) {
  const color = tone === 'success' ? 'text-green-700' : tone === 'error' ? 'text-red-700' : 'text-zinc-900';
  return (
    <div className="bg-zinc-50 rounded-md border border-zinc-200 p-2.5">
      <div className="text-[10.5px] text-zinc-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[16px] font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
