{
  description = "ContextVM Interface CLI";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          cvmi = pkgs.callPackage ./nix/package.nix { };
        in
        {
          inherit cvmi;
          default = cvmi;
        }
      );

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.cvmi}/bin/cvmi";
          meta.description = "ContextVM Interface CLI";
        };
      });

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.pnpm_10
              pkgs.git
              pkgs.nixfmt
            ];
          };
        }
      );

      checks = forAllSystems (system: {
        inherit (self.packages.${system}) cvmi;
      });

      formatter = forAllSystems (system: (pkgsFor system).nixfmt-tree);
    };
}
