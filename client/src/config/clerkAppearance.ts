export const clerkTheme = {
    variables: {
        colorPrimary: '#6366f1',
        colorBackground: '#1a1a2e',
        colorInputBackground: '#252540',
        colorInputText: '#f8fafc',
        colorText: '#f8fafc',
        colorTextSecondary: '#94a3b8',
        colorNeutral: '#334155',
        colorDanger: '#ef4444',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        borderRadius: '12px',
    },
    elements: {
        modalBackdrop: {
            backgroundColor: 'rgba(15, 15, 26, 0.8)',
            backdropFilter: 'blur(5px)',
        },
        modalContent: {
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
        },
        card: {
            backgroundColor: 'transparent',
            border: 'none',
            boxShadow: 'none',
        },
        headerTitle: {
            color: 'var(--text-primary)',
            fontWeight: 700,
        },
        headerSubtitle: {
            color: 'var(--text-secondary)',
        },
        formFieldLabel: {
            color: 'var(--text-secondary)',
        },
        formFieldInput: {
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
        },
        formButtonPrimary: {
            background: 'var(--accent-gradient)',
            border: 'none',
            color: '#ffffff',
            boxShadow: '0 4px 15px rgba(99, 102, 241, 0.4)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            '&:hover': {
                transform: 'translateY(-1px)',
                boxShadow: '0 8px 22px rgba(99, 102, 241, 0.45)',
            },
        },
        socialButtonsBlockButton: {
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
        },
        socialButtonsBlockButtonText: {
            color: 'var(--text-primary)',
        },
        footerActionLink: {
            color: 'var(--accent-primary)',
        },
        dividerLine: {
            backgroundColor: 'var(--border-color)',
        },
        dividerText: {
            color: 'var(--text-muted)',
        },
        formResendCodeLink: {
            color: 'var(--accent-primary)',
        },
        otpCodeFieldInput: {
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
        },
        formFieldErrorText: {
            color: 'var(--error)',
        },
        alertText: {
            color: 'var(--text-primary)',
        },
    },
};

export const clerkOrganizationSwitcherAppearance = {
    elements: {
        rootBox: {
            display: 'flex',
            alignItems: 'center',
        },
        organizationSwitcherTrigger: {
            padding: '0.5rem 0.75rem',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
            transition: 'all 0.2s ease',
            '&:hover': {
                borderColor: 'var(--accent-primary)',
                color: 'var(--text-primary)',
            },
        },
        organizationSwitcherPopoverCard: {
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
        },
        organizationSwitcherPopoverActionButton: {
            color: 'var(--text-secondary)',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            '&:hover': {
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--text-primary)',
            },
        },
        organizationSwitcherPreviewButton: {
            color: 'var(--text-secondary)',
            borderRadius: '8px',
            '&:hover': {
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--text-primary)',
            },
        },
    },
};

export const clerkUserButtonAppearance = {
    elements: {
        rootBox: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            width: '100%',
            padding: '0.5rem 1rem',
        },
        userButtonTrigger: {
            '&:focus': {
                boxShadow: 'none',
            },
        },
        userButtonPopoverCard: {
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
        },
        userButtonPopoverActionButton: {
            color: 'var(--text-secondary)',
            borderRadius: '8px',
            transition: 'all 0.2s ease',
            '&:hover': {
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--text-primary)',
            },
        },
        userButtonPopoverFooterPagesLink: {
            color: 'var(--text-muted)',
            '&:hover': {
                color: 'var(--text-primary)',
            },
        },
    },
};
