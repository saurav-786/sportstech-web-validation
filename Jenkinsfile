// Jenkins pipeline: PR smoke, nightly full crawl, weekly deep scans.
// Configure: a multibranch pipeline + a nightly cron trigger ('H 2 * * *') and weekly ('H 3 * * 1').
// Credentials: anthropic-api-key / openai-api-key / auth-password as Jenkins secrets (optional).
pipeline {
  agent any
  options { timestamps(); timeout(time: 2, unit: 'HOURS') }
  parameters {
    choice(name: 'SCAN_TYPE', choices: ['smoke', 'full', 'seo', 'security', 'performance', 'a11y'], description: 'Scan profile')
    string(name: 'BASE_URL', defaultValue: 'https://www.sportstech.de/', description: 'Target site')
    string(name: 'MAX_PAGES', defaultValue: '100', description: 'Crawl cap')
  }
  environment {
    BASE_URL = "${params.BASE_URL}"
    MAX_PAGES = "${params.MAX_PAGES}"
    CI = 'true'
  }
  triggers {
    cron(env.BRANCH_NAME == 'main' ? 'H 2 * * *' : '')
  }
  stages {
    stage('Setup') {
      steps {
        sh 'npm ci'
        sh 'npx playwright install --with-deps'
      }
    }
    stage('Scan') {
      steps {
        script {
          def commands = [
            smoke: 'npm run test:smoke',
            full: 'npm run scan && npm run lighthouse && npm run pdf',
            seo: 'npm run test:seo',
            security: 'npm run test:security',
            performance: 'npm run test:performance',
            a11y: 'npm run test:a11y'
          ]
          withCredentials([
            string(credentialsId: 'anthropic-api-key', variable: 'ANTHROPIC_API_KEY')
          ]) {
            sh commands[params.SCAN_TYPE]
          }
        }
      }
    }
    stage('Suite Report') {
      when { expression { params.SCAN_TYPE != 'full' } }
      steps { sh 'OPEN_REPORT=0 npm run report:suites' }
    }
  }
  post {
    always {
      archiveArtifacts artifacts: 'reports/**, test-results/**', allowEmptyArchive: true
      publishHTML(target: [reportDir: 'reports', reportFiles: 'dashboard.html', reportName: 'AI Validation Dashboard', allowMissing: true, keepAll: true, alwaysLinkToLastBuild: true])
    }
    failure {
      script {
        if (env.SLACK_WEBHOOK) {
          sh '''curl -s -X POST -H 'Content-type: application/json' \
            --data "{\\"text\\":\\"❌ Website validation (${SCAN_TYPE}) failed: ${BUILD_URL}\\"}" "$SLACK_WEBHOOK"'''
        }
      }
      emailext(subject: "Website validation failed: ${currentBuild.fullDisplayName}",
               body: "Scan ${params.SCAN_TYPE} failed. Dashboard + artifacts: ${env.BUILD_URL}",
               recipientProviders: [requestor(), culprits()])
    }
  }
}
