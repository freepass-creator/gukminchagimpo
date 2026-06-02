'use client';

import { ReactNode } from 'react';
import { Card, CardBody } from '@/components/Card';

interface Props {
  children: ReactNode;
  /** 테이블 영역 최대 높이 (스크롤). 기본: viewport 320px 여백 */
  maxHeight?: string;
  /** 가로 스크롤 허용 */
  scrollX?: boolean;
  /** 헤더 (필터/소제목용) */
  header?: ReactNode;
  /** Card body 추가 클래스 (기본 px-0 pb-0) */
  bodyClassName?: string;
}

/**
 * 목록 페이지용 표준 카드.
 * 페이지 전체가 main의 overflow-y-auto로 한 번 스크롤됨.
 * thead는 stdTheadCls (sticky top-0)로 스크롤 시 화면 상단에 고정됨.
 *
 * 사용:
 * <DataCard>
 *   <table className="w-full text-[12.5px]">
 *     <thead className={stdTheadCls}> ... </thead>
 *     <tbody> ... </tbody>
 *   </table>
 * </DataCard>
 */
export function DataCard({
  children,
  scrollX = false,
  header,
  bodyClassName,
}: Props) {
  return (
    <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {header}
      <CardBody className={`${bodyClassName ?? 'px-0 pb-0'} flex-1 min-h-0 overflow-y-auto ${scrollX ? 'overflow-x-auto' : ''}`}>
        {children}
      </CardBody>
    </Card>
  );
}

/** 표준 thead — sticky 적용된 헤더 */
export const stdTheadCls =
  'sticky top-0 z-10 bg-zinc-50/95 backdrop-blur border-b border-zinc-200 text-zinc-600';

/** 표준 th alignment helpers */
export const thCls = {
  base: 'py-2.5 px-4 font-semibold',
  left: 'text-left py-2.5 px-4 font-semibold',
  center: 'text-center py-2.5 px-4 font-semibold whitespace-nowrap',
  right: 'text-right py-2.5 px-4 font-semibold whitespace-nowrap',
};

export const tdCls = {
  base: 'py-2.5 px-4',
  left: 'text-left py-2.5 px-4',
  center: 'text-center py-2.5 px-4',
  right: 'text-right py-2.5 px-4',
};

/** 표준 tr (호버 효과) */
export const stdTrCls = 'border-b border-zinc-100 last:border-0 hover:bg-zinc-50/80';
