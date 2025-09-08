import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";


const ABI = [
  // events custom
  {
    type: "event",
    name: "DiplomaIssued",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "tokenURI", type: "string" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "DiplomaRevoked",
    inputs: [
      { indexed: true, name: "tokenId", type: "uint256" },
      { indexed: false, name: "reason", type: "string" },
    ],
    anonymous: false,
  },

  // events padrão ERC-1155 (para fallback de parsing)
  {
    type: "event",
    name: "TransferSingle",
    inputs: [
      { indexed: true, name: "operator", type: "address" },
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "id", type: "uint256" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TransferBatch",
    inputs: [
      { indexed: true, name: "operator", type: "address" },
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "ids", type: "uint256[]" },
      { indexed: false, name: "values", type: "uint256[]" },
    ],
    anonymous: false,
  },

  // views helpers / acesso
  {
    type: "function",
    stateMutability: "view",
    name: "INSTITUTION_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },

  // ERC-1155 padrão (para fallback/diagnóstico)
  {
    type: "function",
    stateMutability: "view",
    name: "uri",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "balanceOf",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },

  // suas views
  {
    type: "function",
    stateMutability: "view",
    name: "verifyDiploma",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getDiploma",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "holder", type: "address" },
          { name: "revoked", type: "bool" },
          { name: "revokeReason", type: "string" },
          { name: "tokenURIString", type: "string" },
          {
            name: "core",
            type: "tuple",
            components: [
              { name: "studentName", type: "string" },
              { name: "course", type: "string" },
              { name: "institution", type: "string" },
              { name: "graduationDate", type: "string" },
            ],
          },
        ],
      },
    ],
  },

  // writes
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "mintDiploma",
    inputs: [
      { name: "to", type: "address" },
      { name: "uri_", type: "string" },
      {
        name: "core_",
        type: "tuple",
        components: [
          { name: "studentName", type: "string" },
          { name: "course", type: "string" },
          { name: "institution", type: "string" },
          { name: "graduationDate", type: "string" },
        ],
      },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }], // conforme o contrato sugerido
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "revokeDiploma",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
];

const sepoliaParams = {
  chainId: "0xaa36a7", // 11155111
  chainName: "Ethereum Sepolia",
  nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.sepolia.org"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

function ipfsToHttp(uri) {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + uri.slice(7);
  }
  return uri;
}

function idToHex64(id) {
  return BigInt(id).toString(16).padStart(64, "0");
}

function buildDataUriFromCore(core, extra = {}) {
  const metadata = {
    name: `${core.studentName} - ${core.course}`,
    description: `Diploma emitido por ${core.institution} em ${core.graduationDate}`,
    attributes: [
      { trait_type: "Student", value: core.studentName },
      { trait_type: "Course", value: core.course },
      { trait_type: "Institution", value: core.institution },
      { trait_type: "GraduationDate", value: core.graduationDate },
    ],
    ...extra,
  };
  const json = JSON.stringify(metadata);
  const b64 =
    typeof window === "undefined"
      ? Buffer.from(json).toString("base64")
      : btoa(json);
  return `data:application/json;base64,${b64}`;
}

export default function DiplomaDapp1155() {
  const [hasMM, setHasMM] = useState(false);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState("");
  const [status, setStatus] = useState("");

  const [contractAddress, setContractAddress] = useState("");
  const [contract, setContract] = useState(null);
  const [institutionRole, setInstitutionRole] = useState("0x");
  const [isInstitution, setIsInstitution] = useState(false);

  // mint form
  const [to, setTo] = useState("");
  const [core, setCore] = useState({
    studentName: "",
    course: "",
    institution: "",
    graduationDate: "",
  });
  const [metadataUri, setMetadataUri] = useState("");
  const [minting, setMinting] = useState(false);
  const [lastMintTokenId, setLastMintTokenId] = useState(null);

  // query/verify/revoke
  const [queryTokenId, setQueryTokenId] = useState("");
  const [diplomaView, setDiplomaView] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    const mm = typeof window !== "undefined" && window.ethereum;
    setHasMM(!!mm);
    if (!mm) return;

    const handleAccounts = (accs) => setAccount(accs?.[0] || "");
    const handleChain = (cid) => setChainId(cid);

    mm.request({ method: "eth_accounts" })
      .then((accs) => handleAccounts(accs))
      .catch(() => {});
    mm.request({ method: "eth_chainId" })
      .then((cid) => handleChain(cid))
      .catch(() => {});

    mm.on && mm.on("accountsChanged", handleAccounts);
    mm.on && mm.on("chainChanged", handleChain);

    return () => {
      mm.removeListener && mm.removeListener("accountsChanged", handleAccounts);
      mm.removeListener && mm.removeListener("chainChanged", handleChain);
    };
  }, []);

  const provider = useMemo(() => {
    if (!hasMM) return null;
    return new ethers.BrowserProvider(window.ethereum);
  }, [hasMM, chainId]);

  async function connect() {
    try {
      const accs = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      setAccount(accs[0]);
    } catch (err) {
      setStatus(`falha ao conectar: ${err.message}`);
    }
  }

  async function switchToSepolia() {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: sepoliaParams.chainId }],
      });
    } catch (switchError) {
      if (switchError.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [sepoliaParams],
        });
      } else {
        setStatus(`erro ao trocar rede: ${switchError.message}`);
      }
    }
  }

  async function loadContract() {
    try {
      if (!ethers.isAddress(contractAddress)) {
        setStatus("endereço do contrato inválido");
        return;
      }
      if (!provider) {
        setStatus("provider não disponível");
        return;
      }
      const signer = await provider.getSigner();
      const c = new ethers.Contract(contractAddress, ABI, signer);
      setContract(c);
      setStatus("contrato carregado");

      // Lê o role (ou calcula com ethers.id se o contrato não expor)
      let role;
      try {
        role = await c.INSTITUTION_ROLE();
      } catch {
        role = ethers.id("INSTITUTION_ROLE");
      }
      setInstitutionRole(role);

      if (account) {
        try {
          const isInst = await c.hasRole(role, account);
          setIsInstitution(isInst);
        } catch {
          setIsInstitution(false);
        }
      }
    } catch (err) {
      setStatus(`falha ao carregar contrato: ${err.message}`);
    }
  }

  useEffect(() => {
    (async () => {
      if (contract && account) {
        try {
          const isInst = await contract.hasRole(institutionRole, account);
          setIsInstitution(isInst);
        } catch {
          setIsInstitution(false);
        }
      }
    })();
  }, [contract, account, institutionRole]);

  async function doMint() {
    if (!contract) return setStatus("carregue o contrato primeiro");
    if (!isInstitution) return setStatus("sua conta não possui INSTITUTION_ROLE");
    if (!ethers.isAddress(to)) return setStatus("endereço do aluno inválido");
    if (!metadataUri) return setStatus("preencha o metadata URI (ou gere do core)");

    try {
      setMinting(true);
      setStatus("enviando transação de mint...");
      // mintDiploma(to, uri_, core_) -> retorna tokenId (uint256)
      const tx = await contract.mintDiploma(to, metadataUri, core);
      const rc = await tx.wait();

      let mintedId = null;

      // 1) tenta pegar retorno direto (alguns providers expõem em rc.logs/rc.events? geralmente não),
      // 2) parse do evento custom,
      // 3) fallback TransferSingle
      try {
        for (const log of rc.logs || []) {
          try {
            const parsed = contract.interface.parseLog(log);
            if (parsed?.name === "DiplomaIssued") {
              mintedId = parsed.args?.tokenId?.toString();
              break;
            }
            if (parsed?.name === "TransferSingle" && parsed.args?.from === ethers.ZeroAddress) {
              mintedId = parsed.args?.id?.toString();
              break;
            }
          } catch {}
        }
      } catch {}

      setLastMintTokenId(mintedId || null);
      setStatus(
        mintedId
          ? `mint realizado. tokenId ${mintedId}`
          : "mint realizado. tokenId não extraído (verifique no explorer)"
      );
    } catch (err) {
      setStatus(`erro no mint: ${err.shortMessage || err.message}`);
    } finally {
      setMinting(false);
    }
  }

  async function doGet() {
    if (!contract) return setStatus("carregue o contrato primeiro");
    if (!queryTokenId) return setStatus("informe um tokenId");
    try {
      // usa getDiploma do contrato 1155
      const v = await contract.getDiploma(queryTokenId);

      const viewObj = {
        tokenId: v.tokenId?.toString?.() ?? v[0]?.toString?.(),
        holder: v.holder ?? v[1],
        revoked: v.revoked ?? v[2],
        revokeReason: v.revokeReason ?? v[3],
        tokenURIString: v.tokenURIString ?? v[4],
        core: v.core ?? v[5],
      };
      setDiplomaView(viewObj);
      setVerifyResult(null);
      setStatus("diploma carregado");
    } catch (err) {
      setStatus(`erro ao buscar diploma: ${err.message}`);
    }
  }

  async function doVerify() {
    if (!contract) return setStatus("carregue o contrato primeiro");
    if (!queryTokenId) return setStatus("informe um tokenId");
    try {
      // Preferencial: verifyDiploma(id)
      let ok = false;
      try {
        ok = !!(await contract.verifyDiploma(queryTokenId));
      } catch {
        ok = false;
      }

      // Opcional: combinar com saldo da conta conectada (1155)
      // se quiser validar que a conta tem 1 unidade daquele id
      if (account) {
        try {
          const bal = await contract.balanceOf(account, queryTokenId);
          const has = bal && BigInt(bal) > 0n;
          // Considere válido apenas se não revogado e com saldo
          ok = ok && has;
        } catch {
          // se balanceOf falhar, mantemos o resultado anterior
        }
      }

      setVerifyResult(!!ok);
      setStatus("verificação realizada");
    } catch (err) {
      setStatus(`erro ao verificar: ${err.message}`);
    }
  }

  async function doRevoke() {
    if (!contract) return setStatus("carregue o contrato primeiro");
    if (!isInstitution) return setStatus("sua conta não possui INSTITUTION_ROLE");
    if (!queryTokenId) return setStatus("informe um tokenId");
    try {
      setRevoking(true);
      const tx = await contract.revokeDiploma(queryTokenId, revokeReason || "revoked");
      await tx.wait();
      setStatus("diploma revogado");
    } catch (err) {
      setStatus(`erro ao revogar: ${err.shortMessage || err.message}`);
    } finally {
      setRevoking(false);
    }
  }

  function generateMetadataFromCore() {
    const uri = buildDataUriFromCore(core);
    setMetadataUri(uri);
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-6">
          <p className="text-2xl">Diploma dApp – Soulbound NFT (ERC-1155)</p>
          <p className="text-sm text-neutral-600 mt-1">
            Conecte o MetaMask, carregue o contrato e interaja (mint, verificar, revogar, consultar).
          </p>
        </div>

        {/* Wallet / Network */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="p-4 rounded-2xl shadow bg-white">
            <p className="font-medium">Carteira</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={connect}
                className="px-3 py-2 rounded-xl shadow border bg-neutral-100 hover:bg-neutral-200"
              >
                Conectar MetaMask
              </button>
              <span className="text-sm truncate">
                {account ? `Conectado: ${account}` : "Desconectado"}
              </span>
            </div>
          </div>
          <div className="p-4 rounded-2xl shadow bg-white">
            <p className="font-medium">Rede</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm">chainId atual: {chainId || "?"}</span>
              <button
                onClick={switchToSepolia}
                className="px-3 py-2 rounded-xl shadow border bg-neutral-100 hover:bg-neutral-200"
              >
                Switch para Sepolia
              </button>
            </div>
          </div>
        </div>

        {/* Contract loader */}
        <div className="p-4 rounded-2xl shadow bg-white mb-6">
          <p className="font-medium">Contrato</p>
          <div className="mt-2 flex flex-col md:flex-row gap-2">
            <input
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value.trim())}
              placeholder="Endereço do Diploma1155 (0x...)"
              className="w-full px-3 py-2 rounded-xl border"
            />
            <button
              onClick={loadContract}
              className="px-3 py-2 rounded-xl shadow border bg-neutral-100 hover:bg-neutral-200"
            >
              Carregar
            </button>
          </div>
          {contract && (
            <div className="text-sm text-neutral-700 mt-2 space-y-1">
              <div>
                INSTITUTION_ROLE:{" "}
                <span className="font-mono break-all">{institutionRole}</span>
              </div>
              <div>Você é instituição? {isInstitution ? "Sim" : "Não"}</div>
            </div>
          )}
        </div>

        {/* Mint form */}
        <div className="p-4 rounded-2xl shadow bg-white mb-6">
          <p className="font-medium">Emitir diploma (mint) – requer INSTITUTION_ROLE</p>
          <div className="grid md:grid-cols-2 gap-3 mt-3">
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Endereço do aluno (0x...)"
              className="px-3 py-2 rounded-xl border"
            />
            <input
              value={core.studentName}
              onChange={(e) => setCore({ ...core, studentName: e.target.value })}
              placeholder="Nome do aluno"
              className="px-3 py-2 rounded-xl border"
            />
            <input
              value={core.course}
              onChange={(e) => setCore({ ...core, course: e.target.value })}
              placeholder="Curso"
              className="px-3 py-2 rounded-xl border"
            />
            <input
              value={core.institution}
              onChange={(e) => setCore({ ...core, institution: e.target.value })}
              placeholder="Instituição"
              className="px-3 py-2 rounded-xl border"
            />
            <input
              value={core.graduationDate}
              onChange={(e) => setCore({ ...core, graduationDate: e.target.value })}
              placeholder="Data de conclusão (ISO 8601)"
              className="px-3 py-2 rounded-xl border"
            />
            <input
              value={metadataUri}
              onChange={(e) => setMetadataUri(e.target.value)}
              placeholder="Metadata URI (ipfs://... ou data:...)"
              className="px-3 py-2 rounded-xl border"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={generateMetadataFromCore}
              className="px-3 py-2 rounded-xl shadow border bg-neutral-100 hover:bg-neutral-200"
            >
              Gerar metadata URI do core
            </button>
            <button
              onClick={doMint}
              disabled={minting}
              className="px-3 py-2 rounded-xl shadow border bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-60"
            >
              {minting ? "Minting..." : "Emitir diploma"}
            </button>
          </div>
          {lastMintTokenId && (
            <p className="text-sm mt-2">Último tokenId emitido: {lastMintTokenId}</p>
          )}
        </div>

        {/* Query & Verify */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="p-4 rounded-2xl shadow bg-white">
            <p className="font-medium">Consultar diploma</p>
            <div className="mt-2 flex gap-2">
              <input
                value={queryTokenId}
                onChange={(e) => setQueryTokenId(e.target.value)}
                placeholder="tokenId"
                className="px-3 py-2 rounded-xl border w-full"
              />
              <button
                onClick={doGet}
                className="px-3 py-2 rounded-xl shadow border bg-neutral-100 hover:bg-neutral-200"
              >
                Buscar
              </button>
            </div>
            {diplomaView && (
              <div className="text-sm mt-3 space-y-1">
                <div>tokenId: {diplomaView.tokenId}</div>
                <div>holder: {diplomaView.holder}</div>
                <div>revogado: {diplomaView.revoked ? "sim" : "não"}</div>
                {diplomaView.revoked && (
                  <div>motivo: {diplomaView.revokeReason}</div>
                )}
                <div>
                  tokenURI:{" "}
                  <a
                    href={ipfsToHttp(diplomaView.tokenURIString)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline break-all"
                  >
                    {diplomaView.tokenURIString}
                  </a>
                </div>
                <div className="pt-2">
                  <p className="font-medium">Core</p>
                  <div>Aluno: {diplomaView.core?.studentName}</div>
                  <div>Curso: {diplomaView.core?.course}</div>
                  <div>Instituição: {diplomaView.core?.institution}</div>
                  <div>Conclusão: {diplomaView.core?.graduationDate}</div>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 rounded-2xl shadow bg-white">
            <p className="font-medium">Verificar / Revogar</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={doVerify}
                className="px-3 py-2 rounded-xl shadow border bg-neutral-100 hover:bg-neutral-200"
              >
                Verificar validade
              </button>
              {verifyResult !== null && (
                <span className="text-sm">válido? {verifyResult ? "sim" : "não"}</span>
              )}
            </div>
            <div className="mt-4 space-y-2">
              <input
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="Motivo da revogação"
                className="px-3 py-2 rounded-xl border w-full"
              />
              <button
                onClick={doRevoke}
                disabled={revoking}
                className="px-3 py-2 rounded-xl shadow border bg-red-600 text-white hover:bg-red-500 disabled:opacity-60"
              >
                {revoking ? "Revogando..." : "Revogar diploma"}
              </button>
            </div>
          </div>
        </div>

        {/* Status bar */}
        {status && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
            {status}
          </div>
        )}

      </div>
    </div>
  );
}
