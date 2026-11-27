{
  lib,
  stdenv,
  nodejs_22,
  pnpm_10,
  pnpmConfigHook,
  fetchPnpmDeps,
  makeWrapper,
  git,
  openssh,
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "cvmi";
  version = (lib.importJSON ../package.json).version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../build.config.mjs
      ../tsconfig.json
      ../bin
      ../src
    ];
  };

  nativeBuildInputs = [
    nodejs_22
    pnpm_10
    pnpmConfigHook
    makeWrapper
  ];

  pnpmDeps = fetchPnpmDeps {
    pnpm = pnpm_10;
    inherit (finalAttrs) pname version;
    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.unions [
        ../package.json
        ../pnpm-lock.yaml
      ];
    };
    fetcherVersion = 3;
    hash = "sha256-vePowTRaq9C7fc0irmqB6DOd03k6JEqd+F26yujDAuI=";
  };

  HUSKY = "0";

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    # Reinstall only production dependencies from the already-populated offline store.
    rm -rf node_modules
    pnpm install --offline --prod --frozen-lockfile --ignore-scripts
    mkdir -p "$out/lib/cvmi" "$out/bin"
    cp -r bin dist node_modules package.json "$out/lib/cvmi/"
    for command in cvmi contextvm; do
      makeWrapper ${lib.getExe nodejs_22} "$out/bin/$command" \
        --add-flags "$out/lib/cvmi/bin/cli.mjs" \
        --prefix PATH : ${
          lib.makeBinPath [
            git
            openssh
          ]
        }
    done
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    export HOME="$TMPDIR/check-home"
    mkdir -p "$HOME"
    cd "$TMPDIR"
    "$out/bin/cvmi" --version
    "$out/bin/contextvm" --help
    "$out/bin/cvmi" serve --help
    runHook postInstallCheck
  '';

  meta = {
    description = "ContextVM Interface CLI";
    homepage = "https://github.com/ContextVM/cvmi";
    license = lib.licenses.mit;
    mainProgram = "cvmi";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})
