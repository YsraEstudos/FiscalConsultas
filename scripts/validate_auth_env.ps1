$ErrorActionPreference = "Stop"

$checks = @(
    @{
        Path = ".env"
        Keys = @(
            "AUTH__CLERK_DOMAIN",
            "AUTH__CLERK_ISSUER",
            "AUTH__CLERK_AUDIENCE",
            "AUTH__CLERK_AUTHORIZED_PARTIES",
            "AUTH__CLERK_CLOCK_SKEW_SECONDS"
        )
    },
    @{
        Path = "client/.env.local"
        Keys = @(
            "VITE_CLERK_PUBLISHABLE_KEY",
            "VITE_CLERK_TOKEN_TEMPLATE"
        )
    }
)

$ok = $true

foreach ($check in $checks) {
    $path = $check.Path
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Error -Message ("[ERROR] Arquivo obrigatorio ausente: " + $path) -ErrorAction Continue
        $ok = $false
        continue
    }

    $vars = @{}
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
            $vars[$matches[1]] = $matches[2].Trim()
        }
    }

    foreach ($key in $check.Keys) {
        if (-not $vars.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($vars[$key])) {
            Write-Error -Message ("[ERROR] Defina " + $key + " em " + $path) -ErrorAction Continue
            $ok = $false
        }
    }

    if ($path -eq ".env" -and $vars.ContainsKey("AUTH__CLERK_CLOCK_SKEW_SECONDS")) {
        $clockSkewRaw = $vars["AUTH__CLERK_CLOCK_SKEW_SECONDS"]
        $clockSkew = 0
        if (-not [int]::TryParse($clockSkewRaw, [ref]$clockSkew)) {
            Write-Error `
                -Message ("[ERROR] AUTH__CLERK_CLOCK_SKEW_SECONDS deve ser inteiro (valor atual: " + $clockSkewRaw + ")") `
                -ErrorAction Continue
            $ok = $false
        } elseif ($clockSkew -lt 0) {
            Write-Error `
                -Message "[ERROR] AUTH__CLERK_CLOCK_SKEW_SECONDS nao pode ser negativo." `
                -ErrorAction Continue
            $ok = $false
        } elseif ($clockSkew -lt 120) {
            Write-Warning ("AUTH__CLERK_CLOCK_SKEW_SECONDS=" + $clockSkew + " pode gerar 'immature_signature' em dev. Recomendado: 120.")
        }
    }
}

if (-not $ok) {
    exit 1
}

exit 0
