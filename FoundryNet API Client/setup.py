from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="foundry-client",
    version="2.0.0",
    author="FoundryNet",
    description="Python client for FoundryNet - Universal DePIN Protocol for Work Settlement on Solana",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/FoundryNet/foundry_net_MINT",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        "solana>=0.32.0",
        "solders>=0.20.0",
        "base58>=2.1.1",
        "requests>=2.31.0",
    ],
)
