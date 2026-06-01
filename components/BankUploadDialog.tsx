'use client';

import { useState, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Upload, CheckCircle2, AlertCircle, X, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Modal } from './Modal';
import { Button } from './Button';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { savePayment, updateBilling, saveBankTx, writeAudit } from '@/lib/data';
import { fmtDate, fmtMoney, newId } from '@/lib/utils';
import type { Payment, Billing, BankTransaction } from '@/lib/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ParsedRow {
  raw: string;
  date: string;           // 'YYYY-MM-DD'
  description: string;
  deposit: number;        // 입금
  withdraw: number;       // 출금
  balance: number;
}

interface MatchResult {
  row: ParsedRow;
  tenantId: string | null;
  tenantName: string | null;
  unpaidBillings: Billing[];
  /** 입금 금액으로 어느 청구에 얼마씩 배분할지 */
  allocations: { billing_id: string; amount: number }[];
  status: 'matched' | 'no-tenant' | 'no-unpaid' | 'partial';
}

/** 텍스트를 행 단위 + 콤마/탭 구분으로 파싱 */
function parseBankText(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: ParsedRow[] = [];
  for (const line of lines) {
    const cols = line.includes('\t') ? line.split('\t') : line.split(',');
    if (cols.length < 3) continue;
    // 헤더 스킵
    if (/일자|date|입금|출금|적요|deposit|withdrawal/i.test(line) && rows.length === 0) continue;

    // 일자 자동 추출
    let date = '';
    for (const c of cols) {
      const m = c.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
      if (m) {
        date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        break;
      }
    }

    // 숫자 후보 — 입금/출금/잔액
    const nums = cols
      .map((c) => parseInt(c.replace(/[^\d-]/g, '')))
      .filter((n) => !isNaN(n) && n !== 0);

    let deposit = 0, withdraw = 0, balance = 0;
    if (nums.length >= 3) {
      // 끝쪽 큰 수 = 잔액. 중간 = 거래액
      balance = nums[nums.length - 1];
      const trans = nums[nums.length - 2];
      if (trans > 0) deposit = trans;
      else withdraw = -trans;
    } else if (nums.length === 2) {
      deposit = nums[0];
      balance = nums[1];
    } else if (nums.length === 1) {
      deposit = nums[0];
    }

    // 적요 — 가장 긴 비숫자 셀
    const desc = cols
      .filter((c) => !/\d{4}/.test(c) && c.replace(/[\d,.\s-]/g, '').length > 1)
      .sort((a, b) => b.length - a.length)[0] || '';

    if (deposit > 0 || withdraw > 0) {
      rows.push({
        raw: line,
        date: date || fmtDate(new Date()),
        description: desc.trim(),
        deposit,
        withdraw,
        balance,
      });
    }
  }
  return rows;
}

export function BankUploadDialog({ open, onClose }: Props) {
  const { tenants, billings, today } = useData();
  const { user } = useAuth();
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [step, setStep] = useState<'paste' | 'review'>('paste');
  const [submitting, setSubmitting] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleParse() {
    const rows = parseBankText(rawText);
    if (rows.length === 0) {
      toast.error('읽어낸 거래내역이 없어요 — 파일 형식을 확인해주세요');
      return;
    }
    setParsed(rows);
    setStep('review');
  }

  async function handleFile(file: File) {
    setLoadingFile(true);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
        // 텍스트 파일은 그냥 읽기
        const text = await file.text();
        setRawText(text);
        toast.success(`${file.name} 로드됨 — 파싱 버튼 누르세요`);
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // 시트를 탭 구분 텍스트로 변환 → 기존 파서 재사용
        const tsv = XLSX.utils.sheet_to_csv(ws, { FS: '\t' });
        setRawText(tsv);
        toast.success(`${file.name} 로드됨 — 파싱 버튼 누르세요`);
      } else {
        toast.error('엑셀 파일(.xlsx)을 올려주세요');
      }
    } catch (e: any) {
      toast.error(e?.message || '파일 읽기 실패');
    } finally {
      setLoadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // 자동 매칭
  const matches = useMemo<MatchResult[]>(() => {
    return parsed
      .filter((r) => r.deposit > 0)
      .map((r) => {
        // 입금자명에서 상사 검색
        const matchedTenant = tenants.find((t) => {
          const name = t.name.replace(/주식회사|\(주\)|㈜|\s/g, '');
          const desc = r.description.replace(/주식회사|\(주\)|㈜|\s/g, '');
          return desc.includes(name) || name.includes(desc);
        });

        if (!matchedTenant) {
          return {
            row: r, tenantId: null, tenantName: null,
            unpaidBillings: [], allocations: [], status: 'no-tenant' as const,
          };
        }

        // 그 상사의 미수 청구 (오래된 것부터)
        const unpaid = billings
          .filter((b) => b.tenant_id === matchedTenant.id && b.total > (b.paid_amount || 0))
          .sort((a, b) => a.period.localeCompare(b.period));

        if (unpaid.length === 0) {
          return {
            row: r, tenantId: matchedTenant.id, tenantName: matchedTenant.name,
            unpaidBillings: [], allocations: [], status: 'no-unpaid' as const,
          };
        }

        // FIFO 배분
        let remain = r.deposit;
        const allocs: { billing_id: string; amount: number }[] = [];
        for (const b of unpaid) {
          if (remain <= 0) break;
          const owed = b.total - (b.paid_amount || 0);
          const use = Math.min(owed, remain);
          allocs.push({ billing_id: b.id, amount: use });
          remain -= use;
        }
        const fullyMatched = allocs.reduce((s, a) => s + a.amount, 0) === r.deposit;

        return {
          row: r,
          tenantId: matchedTenant.id,
          tenantName: matchedTenant.name,
          unpaidBillings: unpaid,
          allocations: allocs,
          status: fullyMatched ? 'matched' : 'partial',
        };
      });
  }, [parsed, tenants, billings]);

  const matchedCount = matches.filter((m) => m.status === 'matched').length;
  const partialCount = matches.filter((m) => m.status === 'partial').length;
  const unmatchedCount = matches.filter((m) => m.status !== 'matched' && m.status !== 'partial').length;
  const totalAmount = matches.reduce((s, m) => s + m.allocations.reduce((s2, a) => s2 + a.amount, 0), 0);

  async function applyMatches() {
    setSubmitting(true);
    try {
      let paymentCount = 0;
      // 1) 모든 거래내역 (입금·출금 무관) 자금일보용 저장
      for (const r of parsed) {
        const match = matches.find((m) => m.row === r);
        const tx: BankTransaction = {
          id: newId('TX'),
          date: r.date,
          description: r.description,
          deposit: r.deposit,
          withdraw: r.withdraw,
          balance: r.balance,
          category: r.deposit > 0
            ? (match?.allocations.length ? '수납' : '기타입금')
            : '출금',
          matched_tenant_id: match?.tenantId || undefined,
        };
        await saveBankTx(tx);
      }
      // 2) 매칭된 입금 → payment + billing 업데이트
      const toApply = matches.filter((m) => m.allocations.length > 0);
      for (const m of toApply) {
        for (const a of m.allocations) {
          const b = billings.find((x) => x.id === a.billing_id);
          if (!b) continue;
          await updateBilling(a.billing_id, { paid_amount: (b.paid_amount || 0) + a.amount });
        }
        const p: Payment = {
          id: newId('PM'),
          tenant_id: m.tenantId!,
          amount: m.allocations.reduce((s, a) => s + a.amount, 0),
          paid_at: m.row.date,
          method: '계좌이체',
          allocations: m.allocations,
        };
        await savePayment(p);
        paymentCount++;
      }
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'bank_upload',
        target: `${parsed.length}건`,
        memo: `통장 업로드 — 거래 ${parsed.length}건 저장, 수납 ${paymentCount}건 (${fmtMoney(totalAmount)}원)`,
        at: fmtDate(today),
      });
      toast.success(`거래 ${parsed.length}건 저장 · 수납 ${paymentCount}건 처리`);
      setRawText(''); setParsed([]); setStep('paste');
      onClose();
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally { setSubmitting(false); }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="통장 거래내역 올리기"
      desc={step === 'paste' ? '은행에서 받은 엑셀 파일을 그대로 올리세요' : '자동으로 찾은 입주상사·미수금 매칭 결과 확인 후 한 번에 저장'}
      width={1000}
      footer={
        step === 'paste' ? (
          <>
            <Button variant="ghost" onClick={onClose}>취소</Button>
            <Button variant="primary" onClick={handleParse} disabled={!rawText.trim()}>
              <CheckCircle2 className="w-3.5 h-3.5" /> 내역 확인하기 →
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('paste')}>← 다시 올리기</Button>
            <Button variant="primary" onClick={applyMatches} disabled={submitting || matchedCount + partialCount === 0}>
              {submitting ? '저장 중...' : `전체 ${parsed.length}건 저장 (자동 수납 ${matchedCount + partialCount}건)`}
            </Button>
          </>
        )
      }
    >
      {step === 'paste' ? (
        <div className="space-y-4">
          {/* 1단계 안내 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="font-semibold text-blue-900 mb-2 text-[13px]">
              1️⃣ 은행 거래내역 엑셀 파일을 올려주세요
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt,.tsv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="hidden"
            />
            <Button
              variant="primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={loadingFile}
            >
              <FileSpreadsheet className="w-4 h-4" />
              {loadingFile ? '읽는 중...' : '엑셀 파일 선택 (.xlsx)'}
            </Button>
            <div className="text-[11px] text-blue-700 mt-2">
              · 인터넷뱅킹에서 거래내역 다운로드 받은 엑셀 파일 그대로 OK<br />
              · 컬럼은 자동 인식: 일자 / 입금자명(적요) / 입금 / 출금 / 잔액
            </div>
          </div>

          {/* 또는 직접 붙여넣기 */}
          <details className="border border-zinc-200 rounded-lg p-3">
            <summary className="cursor-pointer text-[12px] text-zinc-600 font-medium">
              엑셀 없이 직접 붙여넣기 (보조)
            </summary>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={8}
              placeholder={`예시:
2026-06-01	천일모터스	2,038,000		120,000,000
2026-06-02	대한오토	2,840,000		122,838,000
2026-06-03	자동이체	500,000	200,000	123,138,000`}
              className="w-full mt-2 font-mono text-[11.5px] border border-zinc-200 rounded-md p-3 focus:outline-none focus:border-zinc-500"
            />
          </details>

          {/* 파일 미리보기 (파일 로드 후 자동 채움) */}
          {rawText && (
            <div className="bg-green-50 border border-green-200 rounded-md p-3 text-[12px] text-green-900">
              ✓ 거래내역이 준비됐습니다. <b>아래 "내역 확인하기 →"</b> 버튼을 눌러주세요.
              <div className="text-[10.5px] text-green-700 mt-1">
                다음 단계에서: 입금자명 = 입주상사 자동 매칭 + 미수금 자동 배분 결과를 확인할 수 있어요
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="입금 건수" value={`${matches.length}건`} />
            <Stat label="매칭 성공" value={`${matchedCount}건`} tone="success" />
            <Stat label="부분 매칭" value={`${partialCount}건`} tone="warn" />
            <Stat label="매칭 실패" value={`${unmatchedCount}건`} tone="error" />
          </div>

          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-[11.5px]">
                <thead className="sticky top-0 bg-zinc-50 z-10 border-b-2 border-zinc-200">
                  <tr>
                    <th className="text-left px-2.5 py-2 font-semibold">일자</th>
                    <th className="text-left px-2.5 py-2 font-semibold">적요</th>
                    <th className="text-right px-2.5 py-2 font-semibold">입금</th>
                    <th className="text-left px-2.5 py-2 font-semibold">매칭 상사</th>
                    <th className="text-left px-2.5 py-2 font-semibold">배분 결과</th>
                    <th className="text-center px-2.5 py-2 font-semibold">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr key={i} className="border-b border-zinc-100">
                      <td className="px-2.5 py-1.5 tabular text-zinc-600">{m.row.date}</td>
                      <td className="px-2.5 py-1.5 text-zinc-700">{m.row.description}</td>
                      <td className="px-2.5 py-1.5 text-right tabular font-medium">{fmtMoney(m.row.deposit)}</td>
                      <td className="px-2.5 py-1.5">
                        {m.tenantName || <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="px-2.5 py-1.5">
                        {m.allocations.length === 0 ? (
                          <span className="text-zinc-400 text-[10.5px]">
                            {m.status === 'no-tenant' ? '상사 매칭 X' : '미수 없음'}
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            {m.allocations.map((a, j) => {
                              const b = billings.find((x) => x.id === a.billing_id);
                              return (
                                <div key={j} className="text-[10.5px] text-zinc-600">
                                  {b?.period} → <span className="font-medium">{fmtMoney(a.amount)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-center">
                        {m.status === 'matched' && <CheckCircle2 className="w-4 h-4 text-green-600 inline" />}
                        {m.status === 'partial' && <AlertCircle className="w-4 h-4 text-amber-600 inline" />}
                        {m.status === 'no-tenant' && <X className="w-4 h-4 text-zinc-400 inline" />}
                        {m.status === 'no-unpaid' && <span className="text-[10px] text-zinc-400">완납</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-[11px] text-zinc-500">
            ✓ = 완전 매칭 (전액 미수 차감) · ⚠ = 부분 매칭 (잔돈 발생) · ✗ = 상사명 매칭 실패 (수동 확인 필요)
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warn' | 'error' }) {
  const color = tone === 'success' ? 'text-green-700' : tone === 'warn' ? 'text-amber-700' : tone === 'error' ? 'text-red-700' : 'text-zinc-900';
  return (
    <div className="bg-zinc-50 rounded-md border border-zinc-200 p-2.5">
      <div className="text-[10.5px] text-zinc-500 uppercase tracking-wide">{label}</div>
      <div className={`text-[16px] font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
