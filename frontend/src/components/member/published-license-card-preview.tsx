"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildCardSimulationSrcDoc,
  calculateCardSimulationFrameLayout,
} from "@/lib/card-simulation";
import {
  CardPreviewHtmlResponse,
  CardSide,
  getMemberLicenseCardPreview,
} from "@/lib/license-card-api";

type PublishedLicenseCardPreviewProps = {
  memberId: number;
  licenseId?: number | null;
  title: string;
  frontLabel: string;
  backLabel: string;
  unavailableLabel: string;
};

const MAX_DISPLAY_WIDTH_PX = 420;
const CARD_CORNER_RADIUS_MM = 3.18;
const CARD_WIDTH_MM = 85;

function CardPreviewFrame({
  payload,
  title,
}: {
  payload: CardPreviewHtmlResponse;
  title: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayWidth, setDisplayWidth] = useState(MAX_DISPLAY_WIDTH_PX);
  const layout = useMemo(() => calculateCardSimulationFrameLayout(payload), [payload]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const updateWidth = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 0) {
        setDisplayWidth(Math.min(MAX_DISPLAY_WIDTH_PX, width));
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const iframeWidth = Math.max(1, Math.round(displayWidth));
  const iframeHeight = Math.max(
    1,
    Math.round(iframeWidth * (layout.renderedHeightPx / layout.renderedWidthPx))
  );
  const srcDoc = useMemo(
    () => buildCardSimulationSrcDoc(payload, { targetWidthPx: iframeWidth }),
    [payload, iframeWidth]
  );
  const cornerRadiusPx = (CARD_CORNER_RADIUS_MM / CARD_WIDTH_MM) * iframeWidth;

  return (
    <div ref={containerRef} className="w-full max-w-[420px]">
      <div
        className="overflow-hidden border border-black/10 bg-white shadow-[0_10px_36px_rgba(15,23,42,0.16)]"
        style={{
          width: iframeWidth,
          height: iframeHeight,
          borderRadius: cornerRadiusPx,
        }}
      >
        <iframe
          title={title}
          className="pointer-events-none block border-0"
          scrolling="no"
          tabIndex={-1}
          width={iframeWidth}
          height={iframeHeight}
          style={{ width: iframeWidth, height: iframeHeight }}
          srcDoc={srcDoc}
        />
      </div>
    </div>
  );
}

export function PublishedLicenseCardPreview({
  memberId,
  licenseId,
  title,
  frontLabel,
  backLabel,
  unavailableLabel,
}: PublishedLicenseCardPreviewProps) {
  const [front, setFront] = useState<CardPreviewHtmlResponse | null>(null);
  const [back, setBack] = useState<CardPreviewHtmlResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const frontPayload = await getMemberLicenseCardPreview(memberId, {
          licenseId: licenseId ?? undefined,
          side: "front",
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        setFront(frontPayload);
        const backHasContent = Boolean(frontPayload.side_summary?.back?.has_content);
        const hasBack = frontPayload.available_sides?.includes("back" as CardSide) && backHasContent;
        if (hasBack) {
          const backPayload = await getMemberLicenseCardPreview(memberId, {
            licenseId: licenseId ?? frontPayload.license_id ?? undefined,
            side: "back",
            signal: controller.signal,
          });
          if (!controller.signal.aborted) {
            setBack(backPayload);
          }
        } else {
          setBack(null);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        setFront(null);
        setBack(null);
        setErrorMessage(error instanceof Error ? error.message : unavailableLabel);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [licenseId, memberId, unavailableLabel]);

  if (isLoading) {
    return (
      <div className="mb-5 rounded-[var(--radius-card)] border border-border/80 bg-secondary/40 px-4 py-5">
        <p className="mb-3 text-sm font-medium text-foreground">{title}</p>
        <div className="flex justify-center">
          <div className="aspect-[85/55] w-full max-w-[420px] animate-pulse rounded-[14px] bg-muted/60" />
        </div>
      </div>
    );
  }

  if (!front) {
    return errorMessage ? (
      <p className="mb-4 text-sm text-muted">{unavailableLabel}</p>
    ) : null;
  }

  return (
    <div className="mb-5 rounded-[var(--radius-card)] border border-border/80 bg-secondary/30 px-4 py-5">
      <p className="mb-4 text-sm font-medium text-foreground">
        {front.template_name || title}
      </p>
      <div className="flex flex-wrap justify-center gap-5">
        <div className="w-[min(100%,420px)] space-y-2">
          <CardPreviewFrame payload={front} title={frontLabel} />
          {back ? <p className="text-center text-xs text-muted">{frontLabel}</p> : null}
        </div>
        {back ? (
          <div className="w-[min(100%,420px)] space-y-2">
            <CardPreviewFrame payload={back} title={backLabel} />
            <p className="text-center text-xs text-muted">{backLabel}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
