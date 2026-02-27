import React, { useMemo, useEffect, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import styles from "./Sidebar.module.css";
import { generateAnchorId, normalizeNCMQuery } from "../utils/id_utils";
import { debug } from "../utils/debug";

interface Position {
  codigo: string;
  descricao: string;
  anchor_id?: string;
  nivel?: number;
  aliquota?: string;
}

interface ChapterSections {
  titulo?: string | null;
  notas?: string | null;
  consideracoes?: string | null;
  definicoes?: string | null;
}

interface Chapter {
  capitulo: string;
  posicoes: Position[];
  notas_gerais?: string | null;
  secoes?: ChapterSections;
}

interface SidebarProps {
  results: Record<string, Chapter> | null;
  onNavigate: (targetId: string) => void;
  isOpen: boolean;
  onClose: () => void;
  searchQuery?: string;
  activeAnchorId?: string | null;
}

// Section navigation item types
type SectionType = "titulo" | "notas" | "consideracoes" | "definicoes";

// Flat list types (Header, Section, or Item)
type SidebarItem =
  | { type: "header"; capitulo: string; count: number }
  | {
      type: "section";
      sectionType: SectionType;
      capitulo: string;
      label: string;
      icon: string;
    }
  | { type: "item"; pos: Position };

// Section metadata for navigation
const SECTION_CONFIG: Record<SectionType, { label: string; icon: string }> = {
  titulo: { label: "Título do Capítulo", icon: "📖" },
  notas: { label: "Notas do Capítulo", icon: "📝" },
  consideracoes: { label: "Considerações Gerais", icon: "📚" },
  definicoes: { label: "Definições Técnicas", icon: "📋" },
};

export const Sidebar = React.memo(function Sidebar({
  results,
  onNavigate,
  isOpen,
  onClose,
  searchQuery,
  activeAnchorId,
}: SidebarProps) {
  debug.log(
    "[Sidebar] Rendering with results keys:",
    results ? Object.keys(results).length : "null",
  );

  const isTipi = useMemo(() => {
    if (!results) return false;
    return Object.values(results).some(
      (chapter: any) =>
        Array.isArray(chapter?.posicoes) &&
        chapter.posicoes.some(
          (pos: any) => "nivel" in pos || "aliquota" in pos,
        ),
    );
  }, [results]);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const lastScrolledQueryRef = useRef<string | null>(null);
  const lastSearchScrollAtRef = useRef<number>(0);

  useEffect(() => {
    lastScrolledQueryRef.current = null;
  }, [results, searchQuery]);

  // 1. Flatten Data & Build Index Map
  const { items, codeToIndex, anchorToIndex } = useMemo(() => {
    if (!results) return { items: [], codeToIndex: {}, anchorToIndex: {} };

    const sortedChapters = Object.values(results).sort(
      (a, b) => Number.parseInt(a.capitulo, 10) - Number.parseInt(b.capitulo, 10),
    );

    const flatList: SidebarItem[] = [];
    const indexMap: Record<string, number> = {};
    const anchorMap: Record<string, number> = {};

    sortedChapters.forEach((chapter) => {
      // Add Header
      flatList.push({
        type: "header",
        capitulo: chapter.capitulo,
        count: chapter.posicoes.length,
      });

      // Add structured section items (NESH only)
      const secoes = chapter.secoes;
      if (secoes) {
        const sectionOrder: SectionType[] = [
          "titulo",
          "notas",
          "consideracoes",
          "definicoes",
        ];
        sectionOrder.forEach((sectionType) => {
          if (secoes[sectionType]) {
            const config = SECTION_CONFIG[sectionType];
            const currentIndex = flatList.length;
            flatList.push({
              type: "section",
              sectionType,
              capitulo: chapter.capitulo,
              label: config.label,
              icon: config.icon,
            });
            const sectionAnchorId = `chapter-${chapter.capitulo}-${sectionType}`;
            anchorMap[sectionAnchorId] = currentIndex;
          }
        });
      } else if (chapter.notas_gerais) {
        // Legacy: single notes item
        const currentIndex = flatList.length;
        flatList.push({
          type: "section",
          sectionType: "notas",
          capitulo: chapter.capitulo,
          label: SECTION_CONFIG.notas.label,
          icon: SECTION_CONFIG.notas.icon,
        });
        const sectionAnchorId = `chapter-${chapter.capitulo}-notas`;
        anchorMap[sectionAnchorId] = currentIndex;
      }

      // Add Positions (sorted numerically by HS Code to ensure correct sequence)
      const sortedPositions = [...chapter.posicoes].sort((a, b) => {
        const [aMaj, aMin] = a.codigo.split(".").map(Number);
        const [bMaj, bMin] = b.codigo.split(".").map(Number);
        return aMaj - bMaj || aMin - bMin;
      });
      sortedPositions.forEach((pos) => {
        const currentIndex = flatList.length;
        flatList.push({ type: "item", pos });

        // Map normalize code to index for fast lookup
        // Store both raw "8417.10" and clean "841710"
        indexMap[pos.codigo] = currentIndex;
        indexMap[pos.codigo.replaceAll(".", "")] = currentIndex;
        anchorMap[generateAnchorId(pos.codigo)] = currentIndex;
      });
    });

    debug.log(
      `[Sidebar] Flattened ${flatList.length} items from ${sortedChapters.length} chapters.`,
    );
    return { items: flatList, codeToIndex: indexMap, anchorToIndex: anchorMap };
  }, [results]);

  const [highlightedIndex, setHighlightedIndex] = React.useState<number | null>(
    null,
  );

  // Sync active anchor from main content to sidebar highlight
  useEffect(() => {
    if (!activeAnchorId) return;
    const idx = anchorToIndex[activeAnchorId];
    if (idx !== undefined) {
      setHighlightedIndex(idx);
      // Optional: Auto-follow? Maybe too aggressive.
      // But highlighting is good.
    }
  }, [activeAnchorId, anchorToIndex]);

  // 2. Handle Auto-Scroll using Virtuoso (Robust Implementation)
  useEffect(() => {
    if (!searchQuery || items.length === 0) return;

    const rawQuery = searchQuery.trim();
    if (!rawQuery) return;

    const normalizedQuery = isTipi ? rawQuery : normalizeNCMQuery(rawQuery);
    // Guard: Check normalized query to prevent loops if format changes slightly
    if (lastScrolledQueryRef.current === normalizedQuery) return; // Prevent re-scroll on same query

    const cleanQuery = isTipi
      ? rawQuery.replaceAll(/\D/g, "")
      : normalizedQuery.replaceAll(".", "");

    debug.log("[Sidebar Autoscroll] Look for:", normalizedQuery);

    const cleanRaw = rawQuery.replaceAll(/\D/g, "");
    // Strategy:
    // 1. Exact Code Match needed? Check indexMap
    // 2. Fallback to clean codes
    let targetIndex = codeToIndex[rawQuery] ?? codeToIndex[cleanRaw];

    if (targetIndex === undefined) {
      // 3. Fallback: Prefix Match (4 digits)
      const positionDigits =
        !isTipi && cleanRaw.length >= 4 ? cleanRaw.slice(0, 4) : cleanRaw;
      const positionDotted =
        !isTipi && positionDigits.length === 4
          ? `${positionDigits.slice(0, 2)}.${positionDigits.slice(2)}`
          : positionDigits;

      targetIndex = codeToIndex[positionDigits] ?? codeToIndex[positionDotted];
    }

    if (targetIndex === undefined) {
      // 4. Normalized Query Match
      targetIndex = codeToIndex[normalizedQuery] ?? codeToIndex[cleanQuery];
    }

    if (targetIndex === undefined) {
      // 5. Scan for startsWith (Last Resort)
      const foundItemIndex = items.findIndex(
        (item) =>
          item.type === "item" &&
          item.pos.codigo.replaceAll(/\D/g, "").startsWith(cleanQuery),
      );
      if (foundItemIndex !== -1) targetIndex = foundItemIndex;
    }

    if (targetIndex !== undefined) {
      debug.log("[Sidebar Autoscroll] Scrolling to index:", targetIndex);
      lastScrolledQueryRef.current = normalizedQuery;
      lastSearchScrollAtRef.current = Date.now();

      // Direct Scroll - Trust Virtuoso
      virtuosoRef.current?.scrollToIndex({
        index: targetIndex,
        align: "center",
        behavior: "auto",
      });

      setHighlightedIndex(targetIndex);

      // Clear highlight after delay
      const timer = setTimeout(() => {
        setHighlightedIndex(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, items, codeToIndex, isTipi]);

  if (!results || Object.keys(results).length === 0) return null;

  return (
    <>
      <div
        className={`${styles.sidebarOverlay} ${isOpen ? styles.open : ""}`}
        onClick={onClose}
      />

      <div
        className={`${styles.navSidebar} ${styles.active} ${isOpen ? styles.mobileOpen : ""} ${isTipi ? styles.navSidebarTipi : ""}`}
      >
        <div className={styles.navHeader}>
          <h3>Navegação</h3>
          <button
            className={styles.closeSidebarBtn}
            onClick={onClose}
            aria-label="Fechar menu"
          >
            ✕
          </button>
        </div>

        <div className={styles.virtualContainer}>
          <Virtuoso
            ref={virtuosoRef}
            data={items}
            totalCount={items.length}
            overscan={
              200
            } /* Pre-render 200px above/below viewport for smoother scroll */
            className={`${styles.virtualList} ${isTipi ? styles.virtualListTipi : ""}`}
            itemContent={(index, item) => {
              if (item.type === "header") {
                return (
                  <div
                    className={`${styles.chapterTitle} ${isTipi ? styles.chapterTitleTipi : ""}`}
                  >
                    <span>Capítulo {item.capitulo}</span>
                    <span className={styles.chapterBadge}>{item.count}</span>
                  </div>
                );
              }

              if (item.type === "section") {
                const sectionAnchorId = `chapter-${item.capitulo}-${item.sectionType}`;
                const styleClass =
                  styles[
                    `sectionItem${item.sectionType.charAt(0).toUpperCase() + item.sectionType.slice(1)}` as keyof typeof styles
                  ] || styles.notesItem;
                const isHighlighted = index === highlightedIndex;
                return (
                  <button
                    className={`${styles.item} ${styles.sectionItem} ${styleClass} ${isHighlighted ? styles.itemHighlight : ""}`}
                    onClick={() => {
                      debug.log(
                        "[Sidebar] Navigating to section:",
                        sectionAnchorId,
                      );
                      onNavigate(sectionAnchorId);
                      if (window.innerWidth < 768) onClose();
                    }}
                    title={item.label}
                  >
                    <span className={styles.itemCode}>{item.icon}</span>
                    <span className={styles.itemDesc}>{item.label}</span>
                  </button>
                );
              }

              const { pos } = item;
              const isHighlighted = index === highlightedIndex;
              const level =
                typeof pos.nivel === "number" ? Math.min(pos.nivel, 5) : null;
              const levelClass = level
                ? styles[`tipiLevel${level}` as keyof typeof styles]
                : "";

              return (
                <button
                  className={`${styles.item} ${isTipi ? styles.itemTipi : ""} ${levelClass} ${isHighlighted ? styles.itemHighlight : ""}`}
                  onClick={() => {
                    const targetId =
                      pos.anchor_id || generateAnchorId(pos.codigo);
                    debug.log("[Sidebar] Navigating to:", targetId);
                    onNavigate(targetId);
                    if (window.innerWidth < 768) onClose();
                  }}
                  title={pos.descricao}
                >
                  <span
                    className={`${styles.itemCode} ${isTipi ? styles.itemCodeTipi : ""}`}
                  >
                    {pos.codigo}
                  </span>
                  <span
                    className={`${styles.itemDesc} ${isTipi ? styles.itemDescTipi : ""}`}
                  >
                    {pos.descricao}
                  </span>
                </button>
              );
            }}
          />
        </div>
      </div>
    </>
  );
});
