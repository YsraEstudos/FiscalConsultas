import { Loading } from '../Loading';
import styles from '../ServicesWorkspace.module.css';

import type {
    OpenCatalogDoc,
    ServicesWorkspaceNebsState,
} from './types';

interface NebsResultsSectionProps {
    readonly nebsState: ServicesWorkspaceNebsState;
    readonly onSelectNebs: (code: string) => void;
}

function NebsResultsSection({
    nebsState,
    onSelectNebs,
}: Readonly<NebsResultsSectionProps>) {
    return (
        <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
                <span>Resultados</span>
                <strong>{nebsState.results.length}</strong>
            </div>

            {nebsState.isSearching ? (
                <Loading label="Buscando notas..." />
            ) : !nebsState.hasSearched ? (
                <div className={styles.emptyState}>
                    <strong>Busque uma nota explicativa</strong>
                    <p>Digite um codigo NEBS ou um termo textual para pesquisar a NEBS.</p>
                </div>
            ) : nebsState.results.length > 0 ? (
                <div className={styles.resultList}>
                    {nebsState.results.map((item) => (
                        <button
                            key={item.code}
                            type="button"
                            className={`${styles.resultCard} ${nebsState.selectedCode === item.code ? styles.resultCardActive : ''}`}
                            onClick={() => onSelectNebs(item.code)}
                        >
                            <div className={styles.resultMeta}>
                                <span className={`${styles.codeBadge} ${styles.interactiveCode} service-code-target`} data-service-code={item.code}>{item.code}</span>
                                <span className={styles.noteBadge}>NEBS</span>
                            </div>
                            <strong className={`${styles.interactiveCode} service-code-target`} data-service-code={item.code}>{item.code} - {item.title}</strong>
                            <span className={styles.resultExcerpt}>{item.excerpt}</span>
                            <span className={styles.levelHint}>Paginas {item.page_start} a {item.page_end}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div className={styles.emptyState}>
                    <strong>Nenhuma nota encontrada</strong>
                    <p>Tente um termo mais amplo ou um codigo completo.</p>
                </div>
            )}
        </aside>
    );
}

interface NebsDetailSectionProps {
    readonly nebsNoteBodyHtml: string;
    readonly nebsState: ServicesWorkspaceNebsState;
    readonly openCatalogDoc: OpenCatalogDoc;
}

function NebsDetailSection({
    nebsNoteBodyHtml,
    nebsState,
    openCatalogDoc,
}: Readonly<NebsDetailSectionProps>) {
    return (
        <section className={styles.detailPanel}>
            {nebsState.isLoadingDetail ? (
                <Loading label="Montando nota..." />
            ) : nebsState.detail ? (
                <>
                    <div className={styles.detailHero}>
                        <div className={`${styles.detailCode} ${styles.interactiveCode} service-code-target`} data-service-code={nebsState.detail.entry.code}>{nebsState.detail.entry.code}</div>
                        <h3>{nebsState.detail.entry.title}</h3>
                        <p className={styles.heroMeta}>
                            {nebsState.detail.entry.section_title || 'Secao nao informada'} • Paginas {nebsState.detail.entry.page_start} a {nebsState.detail.entry.page_end}
                        </p>
                    </div>

                    <div className={styles.breadcrumbs} aria-label="Hierarquia NEBS">
                        {nebsState.detail.ancestors.map((ancestor) => (
                            <button
                                key={ancestor.code}
                                type="button"
                                className={`${styles.crumb} ${styles.interactiveCode} service-code-target`}
                                data-service-code={ancestor.code}
                                onClick={() => openCatalogDoc('nbs', ancestor.code)}
                            >
                                {ancestor.code}
                            </button>
                        ))}
                        <button
                            type="button"
                            className={`${styles.crumbCurrentButton} ${styles.interactiveCode} service-code-target`}
                            data-service-code={nebsState.detail?.item.code}
                            onClick={() => openCatalogDoc('nbs', nebsState.detail?.item.code)}
                        >
                            {nebsState.detail.item.code}
                        </button>
                    </div>

                    <div className={styles.detailGrid}>
                        <section className={styles.card}>
                            <div className={styles.cardLabel}>Servico NEBS vinculado</div>
                            <p>{nebsState.detail.item.description}</p>
                        </section>

                        <section className={styles.card}>
                            <div className={styles.cardLabel}>Origem</div>
                            <p>{nebsState.detail.entry.section_title || 'Secao nao identificada'}</p>
                        </section>
                    </div>

                    <section className={styles.card}>
                        <div className={styles.cardLabel}>Conteudo da nota</div>
                        <div
                            className={styles.noteBody}
                            dangerouslySetInnerHTML={{ __html: nebsNoteBodyHtml }}
                        />
                    </section>

                    <div className={styles.detailActions}>
                        <button
                            type="button"
                            className={styles.secondaryAction}
                            onClick={() => openCatalogDoc('nbs', nebsState.detail?.item.code)}
                        >
                            Abrir item NEBS relacionado
                        </button>
                    </div>
                </>
            ) : (
                <div className={styles.emptyDetail}>
                    <strong>Selecione uma nota</strong>
                    <p>O painel mostra a nota explicativa publicada, a seção de origem e o vínculo com o serviço NEBS.</p>
                </div>
            )}
        </section>
    );
}

interface NebsWorkspaceViewProps {
    readonly nebsNoteBodyHtml: string;
    readonly nebsState: ServicesWorkspaceNebsState;
    readonly onSelectNebs: (code: string) => void;
    readonly openCatalogDoc: OpenCatalogDoc;
}

export function NebsWorkspaceView({
    nebsNoteBodyHtml,
    nebsState,
    onSelectNebs,
    openCatalogDoc,
}: Readonly<NebsWorkspaceViewProps>) {
    return (
        <div className={styles.body}>
            <NebsResultsSection
                nebsState={nebsState}
                onSelectNebs={onSelectNebs}
            />
            <NebsDetailSection
                nebsNoteBodyHtml={nebsNoteBodyHtml}
                nebsState={nebsState}
                openCatalogDoc={openCatalogDoc}
            />
        </div>
    );
}
