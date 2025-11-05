from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="foundry-client",
    version="1.0.0",
    author="FoundryNet",
    description="Python client for FoundryNet - Universal DePIN Protocol for Work Settlement",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/foundrynet/foundry-client-py",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.8",
    install_requires=[
        "PyNaCl>=1.5.0",
        "base58>=2.1.1",
        "requests>=2.31.0",
    ],
)
