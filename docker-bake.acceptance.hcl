group "acceptance" {
  targets = ["runtime"]
}

target "acceptance-image" {
  context    = "."
  dockerfile = "Dockerfile"
}

target "runtime" {
  inherits = ["acceptance-image"]
  target   = "library-runtime"
  tags     = ["evidence-library-acceptance:local"]
}
