'use client';

import { useState, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Upload, CheckCircle2, X, FileSpreadsheet, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { saveTenant, writeAudit } from '@/lib/data';
import { makeTenantId } from '@/lib/codes';
import { fmtDate } from '@/lib/utils';
import type { Tenant } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ParsedTenant {
  name: string;
  biz_no: string;
  ceo: string;
  phone: string;
  duplicate: boolean;
  valid: boolean;
}

export function TenantUploadDialog({ open, onClose }: Props) {
  const { tenants, today } = useData();
  const { user } = useAuth();
  const [rows, setRows] = useState<ParsedTenant[]>([]);
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const data = [
      { '상사명': '○○모터스', '사업자번호': '123-45-67890', '대표': '홍길동', '전화': '010-1234-5678' },
      { '상사명': '△△오토', '사업자번호': '234-56-78901', '대표': '김대표', '전화': '010-2345-6789' },
      { '상사명': '☆☆모빌리티', '사업자번호': '345-67-89012', '대표': '이사장', '전화': '010-3456-7890' },
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '입주상사');
    XLSX.writeFile(wb, '입주상사_업로드양식.xlsx');
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
      } else if (name.endsWith('.csv')) {
        const text = await file.text();
        const wb = XLSX.read(text, { type: 'string' });
        json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      } else {
        toast.error('엑셀(.xlsx)을 올려주세요');
        return;
      }

      // 컬럼 자동 매핑
      const get = (r: any, keys: string[]) => {
        for (const k of keys) {
          for (const rk of Object.keys(r)) {
            if (rk.replace(/\s/g, '').includes(k)) return String(r[rk] || '').trim();
          }
        }
        return '';
      };

      const parsed: ParsedTenant[] = json
        .map((r) => {
          const name = get(r, ['상사명', '법인명', '회사명', '상호']);
          const biz_no = get(r, ['사업자번호', '사업자등록번호', '사업자']);
          const ceo = get(r, ['대표', 'CEO', '대표자']);
          const phone = get(r, ['전화', '연락처', '핸드폰']);
          const valid = !!name;
          const duplicate = tenants.some((t) => t.name === name || (biz_no && t.biz_no === biz_no));
          return { name, biz_no, ceo, phone, valid, duplicate };
        })
        .filter((r) => r.name);

      if (parsed.length === 0) {
        toast.error('읽어낸 입주상사 정보가 없습니다');
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

  const validRows = useMemo(() => rows.filter((r) => r.valid && !r.duplicate), [rows]);
  const dupCount = rows.filter((r) => r.duplicate).length;

  async function submit() {
    if (validRows.length === 0) {
      toast.error('등록 가능한 항목 없음');
      return;
    }
    setSubmitting(true);
    try {
      for (const r of validRows) {
        const t: Tenant = {
          id: makeTenantId(),
          name: r.name,
          biz_no: r.biz_no,
          ceo: r.ceo,
          phone: r.phone,
          deposit_paid: 0,
        };
        await saveTenant(t);
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'tenant_bulk_upload',
        target: `${validRows.length}건`,
        memo: `입주상사 엑셀 일괄 등록 ${validRows.length}건 (중복 ${dupCount} 제외)`,
        at: fmtDate(today),
      });
      toast.success(`${validRows.length}곳 등록 완료`);
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
      title="입주상사 엑셀로 한 번에 등록"
      desc={step === 'upload' ? '엑셀 컬럼: 상사명 · 사업자번호 · 대표 · 전화' : '중복 확인 후 한 번에 등록'}
      width={760}
      footer={
        step === 'upload' ? (
          <Button variant="ghost" onClick={onClose}>취소</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('upload')}>← 다시 올리기</Button>
            <Button variant="primary" onClick={submit} disabled={submitting || validRows.length === 0}>
              {submitting ? '등록 중...' : `${validRows.length}곳 등록`}
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
              <div className="font-semibold text-amber-900">1️⃣ 먼저 양식부터 받으세요</div>
              <div className="text-[11px] text-amber-700 mt-0.5">엑셀 양식 다운로드 → 회사 데이터 채우기 → 아래 업로드</div>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="w-3.5 h-3.5" /> 양식 다운로드
            </Button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="font-semibold text-blue-900 mb-2 text-[13px]">
              2️⃣ 채워진 엑셀 파일 올리기
            </div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              className="hidden" />
            <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
              <FileSpreadsheet className="w-4 h-4" /> 엑셀 파일 선택
            </Button>
            <div className="text-[11px] text-blue-700 mt-2">
              컬럼 자동 인식: <b>상사명 / 사업자번호 / 대표 / 전화</b>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="전체" value={`${rows.length}곳`} />
            <Stat label="등록 예정" value={`${validRows.length}곳`} tone="success" />
            <Stat label="중복 (제외)" value={`${dupCount}곳`} tone="warn" />
          </div>
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <div className="max-h-[360px] overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-zinc-50 z-10 border-b-2 border-zinc-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">상사명</th>
                    <th className="text-left px-3 py-2 font-semibold">사업자번호</th>
                    <th className="text-left px-3 py-2 font-semibold">대표</th>
                    <th className="text-left px-3 py-2 font-semibold">전화</th>
                    <th className="text-center px-3 py-2 font-semibold">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b border-zinc-100 ${r.duplicate ? 'bg-amber-50/50' : ''}`}>
                      <td className="px-3 py-1.5 font-medium">{r.name}</td>
                      <td className="px-3 py-1.5 tabular text-zinc-600">{r.biz_no}</td>
                      <td className="px-3 py-1.5 text-zinc-600">{r.ceo}</td>
                      <td className="px-3 py-1.5 tabular text-zinc-600">{r.phone}</td>
                      <td className="px-3 py-1.5 text-center">
                        {r.duplicate ? (
                          <span className="text-[10.5px] text-amber-700">중복</span>
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-green-600 inline" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warn' }) {
  const color = tone === 'success' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : 'text-zinc-900';
  return (
    <div className="bg-zinc-50 rounded-md border border-zinc-200 p-2.5">
      <div className="text-[10.5px] text-zinc-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[16px] font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
