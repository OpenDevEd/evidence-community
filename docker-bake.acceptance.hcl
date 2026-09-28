group "acceptance" {
  targets = ["runtime"]
}

target "acceptance-image" {
  context    = "."
  dockerfile = "Dockerfile"
  args = {
    SKIP_BUILD_TYPECHECK = "1"
  }
}

target "runtime" {
  inherits = ["acceptance-image"]
  target   = "library-runtime"
  tags     = ["evidence-library-acceptance:local"]
}
